import type { GeneratedFile } from '@/lib/file-generator';

// Estudio creativo de Google (una sola clave de AI Studio):
// - Imagenes y EDICION: primero la ruta HQ — Nano Banana 2.1 por la API
//   de Interactions pidiendo salida 2K (mejor texto y detalle); si esa
//   ruta falla, la cadena generateContent de abajo hace de respaldo.
// - Video: Gemini Omni Flash por la API de Interactions — texto o
//   imagen a video en 1080p con audio; llamada sincrona, el MP4 vuelve
//   en base64 dentro de la respuesta.
// - Musica: Lyria 3.5 — canciones completas en MP3 (o clip de 30 s).
// Todas las salidas llevan marca SynthID de Google. Los IDs de modelo van
// en cadena con respaldo y se pueden anteponer por variables de entorno,
// porque Google renombra previews con frecuencia.

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function googleAiKey(): string | undefined {
  return process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || undefined;
}

function headers() {
  return {
    'Content-Type': 'application/json',
    'x-goog-api-key': googleAiKey() as string,
  };
}

function isModelMissing(status: number, detail: string): boolean {
  return status === 404 || /not found|NOT_FOUND|is not available/i.test(detail);
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  inline_data?: { mime_type: string; data: string };
}

async function generateContent(
  models: string[],
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ parts: GeminiPart[]; model: string }> {
  let lastError: Error | null = null;
  for (const model of models) {
    const res = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      if (isModelMissing(res.status, detail) || res.status === 429) {
        lastError = new Error(`google ${model} ${res.status}`);
        continue;
      }
      throw new Error(`Google respondió ${res.status}. ${detail.slice(0, 240)}`);
    }
    const data = await res.json();
    const parts = (data?.candidates?.[0]?.content?.parts ?? []) as GeminiPart[];
    return { parts, model };
  }
  throw lastError ?? new Error('Ningún modelo de Google respondió.');
}

function partData(part: GeminiPart): { mime: string; data: string } | null {
  if (part.inlineData?.data) return { mime: part.inlineData.mimeType, data: part.inlineData.data };
  if (part.inline_data?.data) return { mime: part.inline_data.mime_type, data: part.inline_data.data };
  return null;
}

function parseDataUrl(dataUrl: string): { mime: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  return match ? { mime: match[1], data: match[2] } : null;
}

// --- Imagen: generar o editar ---------------------------------------------

// Primero el modelo con cuota gratuita real de imagenes; el preview va
// despues: su nivel gratuito de imagen es minimo o nulo y devolvia 429 al
// primer intento aunque el usuario no hubiera creado nada.
const IMAGE_MODELS = [
  ...(process.env.GOOGLE_IMAGE_MODEL ? [process.env.GOOGLE_IMAGE_MODEL] : []),
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
];

export async function googleImage(
  prompt: string,
  editImageDataUrl?: string,
): Promise<{ file: GeneratedFile; note?: string }> {
  const parts: Array<Record<string, unknown>> = [];
  if (editImageDataUrl) {
    const img = parseDataUrl(editImageDataUrl);
    if (img) parts.push({ inlineData: { mimeType: img.mime, data: img.data } });
  }
  parts.push({ text: prompt });

  const { parts: outParts } = await generateContent(
    IMAGE_MODELS,
    {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    },
    120000,
  );

  let note: string | undefined;
  for (const part of outParts) {
    const media = partData(part);
    if (media && media.mime.startsWith('image/')) {
      const ext = media.mime.includes('png') ? 'png' : 'jpg';
      return { file: { name: `imagen-calili.${ext}`, mime: media.mime, base64: media.data }, note };
    }
    if (part.text && !note) note = part.text.trim().slice(0, 300);
  }
  throw new Error('Google no devolvió imagen en su respuesta.');
}

// --- Imagen HQ: Nano Banana 2.1 por Interactions, salida 2K -----------------
// La documentacion vigente de Google pone gemini-nano-banana-2.1 como su
// modelo principal de imagen (mejor texto y calidad, salidas 1K/2K/4K) y
// el tamano se pide con response_format {type:'image', image_size:'2K'}
// por la MISMA API de Interactions que ya usa el video. Si el servidor
// rechaza el formato con tamanio (400), se reintenta una vez sin el.
export async function googleImageHQ(
  prompt: string,
  editImageDataUrl?: string,
  timeoutMs: number = 150_000,
): Promise<{ file: GeneratedFile; note?: string }> {
  const model = process.env.GOOGLE_IMAGE_MODEL_HQ || 'gemini-nano-banana-2.1';
  const input: unknown[] = [{ type: 'text', text: prompt }];
  if (editImageDataUrl) {
    const img = parseDataUrl(editImageDataUrl);
    if (img) input.push({ type: 'image', data: img.data, mime_type: img.mime });
  }

  const attempt = async (withSize: boolean) => fetch(`${BASE}/interactions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model,
      input,
      response_format: withSize ? { type: 'image', image_size: '2K' } : { type: 'image' },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  let res = await attempt(true);
  if (res.status === 400) {
    await res.text().catch(() => '');
    res = await attempt(false);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Google imagen HQ respondió ${res.status}. ${detail.slice(0, 240)}`);
  }
  const data = await res.json();
  if (data?.error) {
    throw new Error(`El motor de imagen HQ falló: ${JSON.stringify(data.error).slice(0, 240)}`);
  }
  // Campo de conveniencia (algunas respuestas lo traen directo)...
  const direct = data?.output_image;
  if (direct?.data) {
    const mime = direct.mime_type || 'image/png';
    const ext = mime.includes('png') ? 'png' : 'jpg';
    return { file: { name: `imagen-calili.${ext}`, mime, base64: direct.data } };
  }
  // ...y en REST crudo la imagen vive en los steps, como el video.
  let note: string | undefined;
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  for (const step of steps) {
    const parts = Array.isArray(step?.content) ? step.content : [];
    for (const part of parts) {
      if (part?.type === 'image' && typeof part?.data === 'string' && part.data) {
        const mime = part.mime_type || 'image/png';
        const ext = mime.includes('png') ? 'png' : 'jpg';
        return { file: { name: `imagen-calili.${ext}`, mime, base64: part.data }, note };
      }
      if (part?.type === 'text' && typeof part?.text === 'string' && !note) {
        note = part.text.trim().slice(0, 300) || undefined;
      }
    }
  }
  throw new Error('El motor de imagen HQ no devolvió imagen en su respuesta.');
}

// --- Video: Veo (asíncrono) -------------------------------------------------

async function fetchFollowingRedirects(url: string): Promise<Buffer> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    // La clave SOLO viaja a dominios de Google: si la descarga redirige a
    // otro host, la cabecera con la clave no lo acompana.
    const host = new URL(current).hostname;
    const isGoogleHost = host === 'googleapis.com' || host.endsWith('.googleapis.com') || host.endsWith('.googleusercontent.com');
    const res = await fetch(current, {
      headers: isGoogleHost ? { 'x-goog-api-key': googleAiKey() as string } : {},
      redirect: 'manual',
      signal: AbortSignal.timeout(60000),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Redirección de video sin destino.');
      current = location;
      continue;
    }
    if (!res.ok) throw new Error(`Descarga de video: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('Demasiadas redirecciones al descargar el video.');
}

export async function googleVideo(
  prompt: string,
  imageDataUrl?: string,
): Promise<{ file: GeneratedFile }> {
  // Google apagó TODOS los IDs Veo de la API de Gemini el 2026-10-22
  // (veo-3.1-*-generate-preview devuelven 404): el video en esta API lo
  // genera Gemini Omni Flash por la API de Interactions, con la MISMA
  // llave y la misma facturación. La llamada es síncrona y el video
  // vuelve en base64 dentro de la respuesta (sin polling ni descarga).
  const model = process.env.GOOGLE_VIDEO_MODEL || 'gemini-omni-1.1-flash';
  const input: unknown[] = [];
  if (imageDataUrl) {
    const img = parseDataUrl(imageDataUrl);
    if (img) input.push({ type: 'image', data: img.data, mime_type: img.mime });
  }
  input.push({ type: 'text', text: prompt });

  const res = await fetch(`${BASE}/interactions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model,
      input,
      response_format: { type: 'video', aspect_ratio: '16:9', resolution: '1080p' },
    }),
    signal: AbortSignal.timeout(270_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Google Omni respondió ${res.status}. ${detail.slice(0, 240)}`);
  }
  const data = await res.json();
  if (data?.error) {
    throw new Error(`El motor de video falló: ${JSON.stringify(data.error).slice(0, 240)}`);
  }
  // En REST el video vive en los steps: el paso model_output trae una
  // parte {type:'video', mime_type, data} con el MP4 en base64.
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  for (const step of steps) {
    const parts = Array.isArray(step?.content) ? step.content : [];
    for (const part of parts) {
      if (part?.type === 'video' && typeof part?.data === 'string' && part.data) {
        return {
          file: { name: 'video-calili.mp4', mime: part.mime_type || 'video/mp4', base64: part.data },
        };
      }
    }
  }
  throw new Error('El motor de video no devolvió video en su respuesta.');
}

// --- Música: Lyria -----------------------------------------------------------

export async function googleMusic(
  prompt: string,
  kind: 'cancion' | 'clip',
): Promise<{ file: GeneratedFile; lyrics?: string }> {
  const models = kind === 'clip'
    ? ['lyria-3-clip-preview', 'lyria-3.5']
    : ['lyria-3.5', 'lyria-3-pro-preview', 'lyria-3-clip-preview'];

  const { parts } = await generateContent(
    models,
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['AUDIO', 'TEXT'] },
    },
    100000,
  );

  let lyrics: string | undefined;
  for (const part of parts) {
    const media = partData(part);
    if (media && media.mime.startsWith('audio/')) {
      const ext = media.mime.includes('wav') ? 'wav' : 'mp3';
      return {
        file: { name: `musica-calili.${ext}`, mime: media.mime, base64: media.data },
        lyrics,
      };
    }
    if (part.text && !lyrics) lyrics = part.text.trim().slice(0, 1200);
  }
  throw new Error('Google no devolvió audio en su respuesta.');
}
