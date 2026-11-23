import type { GeneratedFile } from '@/lib/file-generator';

// Estudio creativo de Google (una sola clave de AI Studio):
// - Imagenes y EDICION: Gemini Flash Image ("Nano Banana") — genera y edita
//   la imagen adjunta conservando el resto, conversando.
// - Video: Veo 3.1 Fast — texto o imagen a video de 8 s con audio; es
//   asincrono (operacion de larga duracion) y aqui se espera el resultado.
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
      if (isModelMissing(res.status, detail)) {
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

const IMAGE_MODELS = [
  ...(process.env.GOOGLE_IMAGE_MODEL ? [process.env.GOOGLE_IMAGE_MODEL] : []),
  'gemini-3.1-flash-image-preview',
  'gemini-2.5-flash-image',
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

// --- Video: Veo (asíncrono) -------------------------------------------------

async function fetchFollowingRedirects(url: string): Promise<Buffer> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(current, {
      headers: { 'x-goog-api-key': googleAiKey() as string },
      redirect: 'manual',
      signal: AbortSignal.timeout(120000),
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
  const model = process.env.GOOGLE_VIDEO_MODEL || 'veo-3.1-fast-generate-preview';
  const instance: Record<string, unknown> = { prompt };
  if (imageDataUrl) {
    const img = parseDataUrl(imageDataUrl);
    if (img) instance.image = { bytesBase64Encoded: img.data, mimeType: img.mime };
  }

  const start = await fetch(`${BASE}/models/${model}:predictLongRunning`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      instances: [instance],
      parameters: { aspectRatio: '16:9', durationSeconds: 8 },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!start.ok) {
    const detail = await start.text().catch(() => '');
    throw new Error(`Google Veo respondió ${start.status}. ${detail.slice(0, 240)}`);
  }
  const opName = (await start.json())?.name as string | undefined;
  if (!opName) throw new Error('Veo no devolvió operación.');

  const deadline = Date.now() + 270000;
  let videoUri: string | undefined;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    const poll = await fetch(`${BASE}/${opName}`, {
      headers: headers(),
      signal: AbortSignal.timeout(30000),
    });
    if (!poll.ok) continue;
    const op = await poll.json();
    if (op?.error) throw new Error(`Veo falló: ${JSON.stringify(op.error).slice(0, 240)}`);
    if (op?.done) {
      videoUri = op?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      break;
    }
  }
  if (!videoUri) throw new Error('El video tardó más de lo esperado y no quedó listo.');

  const buffer = await fetchFollowingRedirects(videoUri);
  return {
    file: { name: 'video-calili.mp4', mime: 'video/mp4', base64: buffer.toString('base64') },
  };
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
    240000,
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
