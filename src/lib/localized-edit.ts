import { streamVisionChat } from '@/lib/nexus-gateway';
import { googleImageHQ } from '@/lib/google-media';
import { createImage } from '@/lib/image-generator';
import type { GeneratedFile } from '@/lib/file-generator';

// Edición LOCALIZADA de imágenes (la respuesta al «no se parece ni un
// 5%»): crear_imagen REPINTA la imagen entera y por eso un logo nunca
// sale igual. Aquí el cambio se hace solo donde va:
//  1. El modelo de visión localiza el elemento (caja 0-1000).
//  2. Se recorta esa zona con margen y SOLO el recorte se edita con el
//     motor HQ (un fragmento chico es donde mejor rinde el texto).
//  3. El recorte editado se pega sobre el ORIGINAL con los bordes
//     difuminados: todo lo demás conserva sus píxeles exactos.
// Si cualquier paso falla, se cae a la recreación completa de siempre
// y el resultado lo declara (precise=false) para que el modelo no
// prometa una fidelidad que no se logró.

interface BBox { xMin: number; yMin: number; xMax: number; yMax: number }

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  return match ? { mime: match[1], buffer: Buffer.from(match[2], 'base64') } : null;
}

async function locateElement(imageDataUrl: string, elemento: string): Promise<BBox | null> {
  const messages = [
    {
      role: 'system',
      content: 'Localizas elementos dentro de imágenes. Respondes SOLO con un objeto JSON, sin texto adicional.',
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Encuentra este elemento en la imagen: ${elemento}. Responde ÚNICAMENTE con JSON {"x_min":0,"y_min":0,"x_max":1000,"y_max":1000} usando coordenadas relativas 0-1000 que encierren el elemento completo, con todo su texto y adornos. Si el elemento no aparece, responde {"found":false}.`,
        },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ];
  let text = '';
  for await (const chunk of streamVisionChat(messages)) text += chunk;
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    if (parsed.found === false) return null;
    const box = {
      xMin: Number(parsed.x_min), yMin: Number(parsed.y_min),
      xMax: Number(parsed.x_max), yMax: Number(parsed.y_max),
    };
    if (![box.xMin, box.yMin, box.xMax, box.yMax].every((n) => Number.isFinite(n))) return null;
    if (box.xMax <= box.xMin || box.yMax <= box.yMin) return null;
    return box;
  } catch {
    return null;
  }
}

function featherMaskSvg(width: number, height: number): Buffer {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="70%" stop-color="white" stop-opacity="1"/><stop offset="100%" stop-color="white" stop-opacity="0"/></radialGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`;
  return Buffer.from(svg);
}

export async function localizedEdit(args: {
  imageDataUrl: string;
  elemento: string;
  cambio: string;
}): Promise<{ file: GeneratedFile; precise: boolean }> {
  const fallback = async (): Promise<{ file: GeneratedFile; precise: boolean }> => {
    const result = await createImage(
      { prompt: args.cambio, usar_adjunta: true },
      args.imageDataUrl,
    );
    return { file: result.file, precise: false };
  };

  const parsed = parseDataUrl(args.imageDataUrl);
  if (!parsed) return fallback();

  const box = await locateElement(args.imageDataUrl, args.elemento).catch((error) => {
    console.error('Calili: edición localizada — visión no localizó', error);
    return null;
  });
  if (!box) {
    console.error('Calili: edición localizada — elemento no localizado, se recrea completo');
    return fallback();
  }

  const sharp = (await import('sharp')).default;
  const metadata = await sharp(parsed.buffer).metadata();
  const imgW = metadata.width ?? 0;
  const imgH = metadata.height ?? 0;
  if (!imgW || !imgH) return fallback();

  // Caja en píxeles con margen generoso: la costura cae lejos del
  // elemento, en fondo uniforme, y el editor tiene contexto de estilo.
  let left = Math.floor((box.xMin / 1000) * imgW);
  let top = Math.floor((box.yMin / 1000) * imgH);
  let right = Math.ceil((box.xMax / 1000) * imgW);
  let bottom = Math.ceil((box.yMax / 1000) * imgH);
  const padX = Math.round((right - left) * 0.45);
  const padY = Math.round((bottom - top) * 0.7);
  left = Math.max(0, left - padX);
  top = Math.max(0, top - padY);
  right = Math.min(imgW, right + padX);
  bottom = Math.min(imgH, bottom + padY);
  // Recorte mínimo útil: si la caja quedó muy chica, se expande.
  if (right - left < 220) { const c = (left + right) / 2; left = Math.max(0, Math.floor(c - 110)); right = Math.min(imgW, left + 220); }
  if (bottom - top < 160) { const c = (top + bottom) / 2; top = Math.max(0, Math.floor(c - 80)); bottom = Math.min(imgH, top + 160); }
  const cropW = right - left;
  const cropH = bottom - top;

  const crop = await sharp(parsed.buffer)
    .extract({ left, top, width: cropW, height: cropH })
    .png()
    .toBuffer();
  // El fragmento viaja grande al editor: en chico el texto se deforma.
  const cropForEdit = cropW < 1024
    ? await sharp(crop).resize({ width: 1024 }).png().toBuffer()
    : crop;
  const cropDataUrl = `data:image/png;base64,${cropForEdit.toString('base64')}`;

  const edited = await googleImageHQ(
    `Edit this image fragment with ONE change: ${args.cambio}. Keep everything else in the fragment exactly the same — identical lettering style, colors, textures, ornaments and background. Do not add or remove anything else.`,
    cropDataUrl,
  );
  const patchBuffer = Buffer.from(edited.file.base64, 'base64');

  const patch = await sharp(patchBuffer)
    .resize(cropW, cropH, { fit: 'fill' })
    .composite([{ input: featherMaskSvg(cropW, cropH), blend: 'dest-in' }])
    .png()
    .toBuffer();

  const isJpeg = /jpe?g/i.test(parsed.mime) || metadata.format === 'jpeg';
  const composed = sharp(parsed.buffer).composite([{ input: patch, left, top }]);
  const outBuffer = isJpeg
    ? await composed.jpeg({ quality: 92 }).toBuffer()
    : await composed.png().toBuffer();

  return {
    file: {
      name: isJpeg ? 'imagen-editada.jpg' : 'imagen-editada.png',
      mime: isJpeg ? 'image/jpeg' : 'image/png',
      base64: outBuffer.toString('base64'),
    },
    precise: true,
  };
}
