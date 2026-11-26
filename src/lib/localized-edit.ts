import { streamVisionChat } from '@/lib/nexus-gateway';
import { googleImageHQ } from '@/lib/google-media';
import type { GeneratedFile } from '@/lib/file-generator';

// Edición LOCALIZADA de imágenes (la respuesta al «no se parece ni un
// 5%»): crear_imagen REPINTA la imagen entera y por eso un logo nunca
// sale igual. Aquí el cambio se hace solo donde va:
//  1. El modelo de visión localiza el elemento (caja 0-1000).
//  2. Se recorta esa zona con margen y SOLO el recorte se edita con el
//     motor HQ (un fragmento chico es donde mejor rinde el texto).
//  3. El recorte editado se pega sobre el ORIGINAL con los bordes
//     difuminados: todo lo demás conserva sus píxeles exactos.
//
// v3.4.2 — dos correcciones de raíz tras el juicio en vivo de Luis
// (2026-11-26: 126 s de espera y le devolvió su mismo logo sin el
// cambio, declarado como éxito):
//  A. VERIFICACIÓN: el éxito ya no se declara porque la tubería no
//     tronó. Tras componer, el modelo de visión comprueba que el
//     cambio pedido ESTÁ en el resultado; si no está, se reintenta
//     una vez con la instrucción reforzada, y si tampoco, la función
//     devuelve failed=true y NO entrega archivo: el modelo debe
//     decirlo honestamente en vez de entregar el original como logro.
//  B. PRESUPUESTO: cada pierna tiene su timeout acotado (localizar
//     30 s, editar 75 s, verificar 30 s; peor caso con reintento
//     ~4 min, dentro del maxDuration de la ruta) y DESAPARECE la
//     cascada de respaldos anterior (createImage completo tras cada
//     fallo: 150+120+120 s más) que hacía el turno eterno.

const LOCATE_TIMEOUT_MS = 30_000;
const EDIT_TIMEOUT_MS = 75_000;
const VERIFY_TIMEOUT_MS = 30_000;

interface BBox { xMin: number; yMin: number; xMax: number; yMax: number }

export interface LocalizedEditResult {
  file?: GeneratedFile;
  precise: boolean;
  failed?: boolean;
}

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  return match ? { mime: match[1], buffer: Buffer.from(match[2], 'base64') } : null;
}

async function visionJson(messages: unknown[], timeoutMs: number): Promise<Record<string, unknown> | null> {
  let text = '';
  for await (const chunk of streamVisionChat(messages, AbortSignal.timeout(timeoutMs))) text += chunk;
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function locateElement(imageDataUrl: string, elemento: string): Promise<BBox | null> {
  const parsed = await visionJson([
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
  ], LOCATE_TIMEOUT_MS);
  if (!parsed || parsed.found === false) return null;
  const box = {
    xMin: Number(parsed.x_min), yMin: Number(parsed.y_min),
    xMax: Number(parsed.x_max), yMax: Number(parsed.y_max),
  };
  if (![box.xMin, box.yMin, box.xMax, box.yMax].every((n) => Number.isFinite(n))) return null;
  if (box.xMax <= box.xMin || box.yMax <= box.yMin) return null;
  return box;
}

// ¿El cambio pedido ESTÁ visible en el resultado? Sin esta compuerta,
// un editor que devuelve el fragmento intacto produce un compuesto
// idéntico al original y se entregaba como éxito (juicio 2026-11-26).
async function verifyChange(resultDataUrl: string, elemento: string, cambio: string): Promise<boolean> {
  const parsed = await visionJson([
    {
      role: 'system',
      content: 'Verificas ediciones de imágenes. Respondes SOLO con un objeto JSON, sin texto adicional.',
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Se pidió esta edición sobre el elemento «${elemento}»: ${cambio}. Mira la imagen RESULTADO y responde ÚNICAMENTE con JSON {"applied":true} si el cambio pedido ya está visible en la imagen (el elemento ya muestra su forma nueva), o {"applied":false} si la imagen sigue mostrando el elemento en su forma original, sin el cambio.`,
        },
        { type: 'image_url', image_url: { url: resultDataUrl } },
      ],
    },
  ], VERIFY_TIMEOUT_MS);
  return parsed?.applied === true;
}

function featherMaskSvg(width: number, height: number): Buffer {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="70%" stop-color="white" stop-opacity="1"/><stop offset="100%" stop-color="white" stop-opacity="0"/></radialGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`;
  return Buffer.from(svg);
}

export async function localizedEdit(args: {
  imageDataUrl: string;
  elemento: string;
  cambio: string;
}): Promise<LocalizedEditResult> {
  const failed: LocalizedEditResult = { precise: false, failed: true };

  const parsed = parseDataUrl(args.imageDataUrl);
  if (!parsed) return failed;

  const box = await locateElement(args.imageDataUrl, args.elemento).catch((error) => {
    console.error('Calili: edición localizada — visión no localizó', error);
    return null;
  });
  if (!box) {
    console.error('Calili: edición localizada — elemento no localizado, fallo honesto (sin recreación en cascada)');
    return failed;
  }

  const sharp = (await import('sharp')).default;
  const metadata = await sharp(parsed.buffer).metadata();
  const imgW = metadata.width ?? 0;
  const imgH = metadata.height ?? 0;
  if (!imgW || !imgH) return failed;

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
  const isJpeg = /jpe?g/i.test(parsed.mime) || metadata.format === 'jpeg';

  // Un intento de edición + composición. Devuelve el resultado ya
  // compuesto en base64, listo para verificar y (si pasa) entregar.
  const attemptEdit = async (reinforced: boolean): Promise<{ base64: string; mime: string; ext: string }> => {
    const instruction = reinforced
      ? `CRITICAL: a previous attempt returned this fragment UNCHANGED and failed verification. You MUST actually apply this change — do not return the fragment as-is: ${args.cambio}. The changed element must be visibly different from the original, rendered in the identical lettering style, colors, textures, ornaments and background. Keep everything else in the fragment exactly the same.`
      : `Edit this image fragment with ONE change: ${args.cambio}. Keep everything else in the fragment exactly the same — identical lettering style, colors, textures, ornaments and background. Do not add or remove anything else.`;
    const edited = await googleImageHQ(instruction, cropDataUrl, EDIT_TIMEOUT_MS);
    const patchBuffer = Buffer.from(edited.file.base64, 'base64');
    const patch = await sharp(patchBuffer)
      .resize(cropW, cropH, { fit: 'fill' })
      .composite([{ input: featherMaskSvg(cropW, cropH), blend: 'dest-in' }])
      .png()
      .toBuffer();
    const composed = sharp(parsed.buffer).composite([{ input: patch, left, top }]);
    const outBuffer = isJpeg
      ? await composed.jpeg({ quality: 92 }).toBuffer()
      : await composed.png().toBuffer();
    return {
      base64: outBuffer.toString('base64'),
      mime: isJpeg ? 'image/jpeg' : 'image/png',
      ext: isJpeg ? 'jpg' : 'png',
    };
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    let composed: { base64: string; mime: string; ext: string };
    try {
      composed = await attemptEdit(attempt === 1);
    } catch (error) {
      console.error(`Calili: edición localizada — el editor falló (intento ${attempt + 1})`, error);
      return failed;
    }
    const resultDataUrl = `data:${composed.mime};base64,${composed.base64}`;
    const applied = await verifyChange(resultDataUrl, args.elemento, args.cambio).catch((error) => {
      console.error('Calili: edición localizada — la verificación falló', error);
      return false;
    });
    if (applied) {
      return {
        file: { name: `imagen-editada.${composed.ext}`, mime: composed.mime, base64: composed.base64 },
        precise: true,
      };
    }
    console.error(`Calili: edición localizada — cambio NO verificado en el resultado (intento ${attempt + 1} de 2)`);
  }
  // Dos intentos sin cambio verificable: fallo honesto, sin archivo.
  // Entregar el original como si fuera la edición era el defecto.
  return failed;
}
