// Video con Seedance 2 vía ME AI (v3.4.4) — el token de Calili en
// ME AI trae los modelos sd-2-c1, sd-2-c2 y sd-2-fast, que son la
// familia Seedance 2 de ByteDance con el nombre corto del agregador
// (confirmado por Luis en su consola, 2026-11-27: «sí lo tengo, solo
// está con otro nombre»). Corre sobre el MISMO saldo MEAI_API_KEY que
// ya paga el chat y la visión: sin llave ni pago adicional.
//
// Formato confirmado por sonda contra la cuenta real (2026-11-27):
// POST /v1/videos {model, prompt} crea una TAREA asíncrona (la ruta
// /v1/video/generations es su alias y responde igual). La pasarela
// traduce el prompt al content[] de ByteDance («bytedance/reference-
// to-video» río arriba) y devuelve id/task_id; el estado se consulta
// con GET /v1/videos/{task_id}. Una petición inválida crea la tarea y
// la marca FAILED con el error río arriba anidado en `message` — por
// eso aquí ningún cuerpo crudo sube al usuario: el detalle se registra
// en el servidor y el error que viaja es limpio, como manda la v3.4.3.
import type { GeneratedFile } from '@/lib/file-generator';

const BASE = (process.env.MEAI_BASE_URL || 'https://api.meai.cloud/v1').replace(/\/+$/, '');
// sd-2-c1 = Seedance 2 estándar (calidad). MEAI_VIDEO_MODEL permite
// cambiar a sd-2-fast o sd-2-c2 sin tocar código.
const MODEL = process.env.MEAI_VIDEO_MODEL || 'sd-2-c1';
const POLL_EVERY_MS = 5_000;
// La ruta del chat vive bajo maxDuration 300: el presupuesto de
// espera deja margen para responder dentro del mismo turno.
const POLL_DEADLINE_MS = 210_000;

const SUCCESS = new Set(['success', 'succeeded', 'completed', 'complete', 'done', 'finished']);
const FAILURE = new Set(['failed', 'failure', 'error', 'cancelled', 'canceled', 'expired']);

function apiKey(): string {
  const key = process.env.MEAI_API_KEY;
  if (!key) throw new Error('El video por ME AI no está configurado: falta MEAI_API_KEY.');
  return key;
}

function headers(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// El error río arriba viene anidado: message es un JSON en texto con
// otro message dentro («InvalidParameter: The parameter content[0]…»).
// Se extrae el texto legible para el registro y para decidir el fallo.
function nestedErrorText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const msg = (body as { message?: unknown }).message;
  if (typeof msg !== 'string') return '';
  try {
    const inner = JSON.parse(msg);
    const parts = [inner?.message, inner?.data?.error, inner?.error]
      .filter((p): p is string => typeof p === 'string' && Boolean(p));
    return parts[0] ?? msg;
  } catch {
    return msg;
  }
}

function taskIdOf(body: any): string {
  return String(body?.id ?? body?.task_id ?? body?.data?.id ?? body?.data?.task_id ?? '');
}

function statusOf(body: any): string {
  return String(body?.status ?? body?.data?.status ?? '').toLowerCase();
}

// La URL del video puede venir en data.outputs (arreglo o texto), en
// data.urls.get o suelta en el cuerpo; como último recurso se busca
// cualquier URL .mp4 en el objeto completo.
function resultUrlOf(body: any): string {
  const candidates: unknown[] = [
    body?.data?.outputs,
    body?.data?.url,
    body?.data?.urls?.get,
    body?.output?.url,
    body?.url,
    body?.video_url,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && /^https?:\/\//.test(c)) return c;
    if (Array.isArray(c)) {
      const hit = c.find((x) => typeof x === 'string' && /^https?:\/\//.test(x));
      if (hit) return hit;
    }
  }
  const flat = JSON.stringify(body ?? {});
  const match = /https?:\/\/[^\s"']+\.mp4[^\s"']*/.exec(flat);
  return match ? match[0] : '';
}

async function downloadVideo(url: string, taskId: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (res.ok) return Buffer.from(await res.arrayBuffer());
  console.error(`Calili: descarga del video Seedance respondió ${res.status}; se prueba /content`);
  const content = await fetch(`${BASE}/videos/${taskId}/content`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (!content.ok) throw new Error('No se pudo descargar el video generado.');
  return Buffer.from(await content.arrayBuffer());
}

// Misma firma que googleVideo: prompt en inglés y, si el usuario
// adjuntó una imagen, esa imagen como primer cuadro (campo image,
// la convención de esta pasarela para video desde imagen).
export async function seedanceVideo(
  prompt: string,
  imageDataUrl?: string,
): Promise<{ file: GeneratedFile }> {
  const submit = await fetch(`${BASE}/videos`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: MODEL,
      prompt,
      ...(imageDataUrl ? { image: imageDataUrl } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const submitBody = await submit.json().catch(() => null);
  if (!submit.ok) {
    const detail = nestedErrorText(submitBody) || JSON.stringify(submitBody ?? {}).slice(0, 300);
    console.error(`Calili: Seedance — la creación de la tarea respondió ${submit.status}: ${detail}`);
    throw new Error(`El motor de video respondió ${submit.status}.`);
  }
  const taskId = taskIdOf(submitBody);
  if (!taskId) {
    console.error('Calili: Seedance — respuesta sin id de tarea', JSON.stringify(submitBody).slice(0, 300));
    throw new Error('El motor de video no devolvió tarea.');
  }
  if (FAILURE.has(statusOf(submitBody))) {
    console.error('Calili: Seedance — tarea fallida al crear', nestedErrorText(submitBody));
    throw new Error('El motor de video rechazó la generación.');
  }

  const deadline = Date.now() + POLL_DEADLINE_MS;
  let lastBody: any = submitBody;
  while (Date.now() < deadline) {
    if (!SUCCESS.has(statusOf(lastBody))) await sleep(POLL_EVERY_MS);
    const poll = await fetch(`${BASE}/videos/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!poll.ok) {
      const detail = await poll.text().catch(() => '');
      console.error(`Calili: Seedance — la consulta de la tarea respondió ${poll.status}: ${detail.slice(0, 300)}`);
      throw new Error(`El motor de video respondió ${poll.status}.`);
    }
    lastBody = await poll.json().catch(() => null);
    const status = statusOf(lastBody);
    if (SUCCESS.has(status)) {
      const url = resultUrlOf(lastBody);
      const bytes = url
        ? await downloadVideo(url, taskId)
        : Buffer.from(
            await (
              await fetch(`${BASE}/videos/${taskId}/content`, {
                headers: { Authorization: `Bearer ${apiKey()}` },
                signal: AbortSignal.timeout(120_000),
              })
            ).arrayBuffer(),
          );
      if (!bytes.length) throw new Error('El motor de video devolvió un archivo vacío.');
      return {
        file: { name: 'video-calili.mp4', mime: 'video/mp4', base64: bytes.toString('base64') },
      };
    }
    if (FAILURE.has(status)) {
      console.error('Calili: Seedance — la tarea terminó en fallo', nestedErrorText(lastBody) || JSON.stringify(lastBody).slice(0, 300));
      throw new Error('El motor de video no pudo generar este video.');
    }
  }
  throw new Error('El motor de video tardó demasiado en generar el video.');
}
