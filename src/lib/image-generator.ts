import type { GeneratedFile } from '@/lib/file-generator';

// Creación y edición de imágenes reales.
// - Con OPENAI_API_KEY: gpt-image-1 (genera y EDITA la imagen adjunta).
// - Sin clave: Pollinations (generación desde texto, sin costo ni cuenta).
// La edición de una adjunta sin clave cae a generar una imagen nueva a
// partir del prompt detallado que escribe el modelo.

export interface CreateImageArgs {
  prompt: string;
  usar_adjunta?: boolean;
}

export interface CreateImageResult {
  file: GeneratedFile;
  engine: 'openai' | 'openai-edit' | 'pollinations';
  note?: string;
}

function toFile(base64: string, mime: string, ext: string): GeneratedFile {
  return {
    name: `imagen-calili.${ext}`,
    mime,
    base64,
  };
}

async function openaiGenerate(prompt: string): Promise<GeneratedFile> {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1024' }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`openai imagenes ${res.status}`);
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('openai no devolvio imagen');
  return toFile(b64, 'image/png', 'png');
}

async function openaiEdit(prompt: string, imageDataUrl: string): Promise<GeneratedFile> {
  const match = imageDataUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
  if (!match) throw new Error('imagen adjunta invalida');
  const buffer = Buffer.from(match[2], 'base64');
  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', prompt);
  form.append('size', '1024x1024');
  form.append('image', new Blob([new Uint8Array(buffer)], { type: match[1] }), 'adjunta.png');
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`openai edicion ${res.status}`);
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('openai no devolvio imagen editada');
  return toFile(b64, 'image/png', 'png');
}

async function pollinationsGenerate(prompt: string): Promise<GeneratedFile> {
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`pollinations ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 5000) throw new Error('pollinations devolvio una imagen vacia');
  return toFile(buffer.toString('base64'), 'image/jpeg', 'jpg');
}

export async function createImage(
  args: CreateImageArgs,
  attachedImage?: string,
): Promise<CreateImageResult> {
  const prompt = String(args?.prompt || '').trim();
  if (!prompt) throw new Error('Falta la descripción de la imagen.');
  const wantsEdit = Boolean(args?.usar_adjunta && attachedImage);

  if (process.env.OPENAI_API_KEY) {
    if (wantsEdit && attachedImage) {
      const file = await openaiEdit(prompt, attachedImage);
      return { file, engine: 'openai-edit' };
    }
    const file = await openaiGenerate(prompt);
    return { file, engine: 'openai' };
  }

  const file = await pollinationsGenerate(prompt);
  return {
    file,
    engine: 'pollinations',
    note: wantsEdit
      ? 'Se generó una imagen NUEVA a partir de la descripción (la edición directa de la adjunta requiere la clave de OpenAI).'
      : undefined,
  };
}
