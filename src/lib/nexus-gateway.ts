// Pasarela NEXUS de Calili.
// Un solo punto de salida hacia el modelo. Ningún proveedor queda cableado
// en las rutas ni en la interfaz: todo se decide por variables de entorno.
//
// Proveedores (API compatible con OpenAI, /chat/completions):
//   - meai  : principal si MEAI_API_KEY está definida (el pool propio de
//             Luis, el mismo que alimenta EditCoreAI). Base:
//             https://api.meai.cloud/v1. Modelo: MEAI_MODEL (por defecto
//             claude-sonnet-4.6). Visión: MEAI_VISION_MODEL (glm-5.2).
//   - groq  : respaldo. Requiere GROQ_API_KEY. Modelo: NEXUS_MODEL
//             (por defecto openai/gpt-oss-120b).
//   - local : desarrollo / respaldo en la PC de Luis. Solo se activa si
//             NEXUS_LOCAL_URL está definida (p. ej. http://127.0.0.1:11434/v1
//             para Ollama o http://127.0.0.1:1234/v1 para LM Studio).
//             Modelo: NEXUS_LOCAL_MODEL. Clave opcional: NEXUS_LOCAL_API_KEY.
//
// Orden: meai → groq → local; NEXUS_PRIMARY puede anteponer otro. Si el
// proveedor primario falla ANTES de entregar el primer token, se intenta
// el siguiente.

export interface NexusMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface NexusProvider {
  id: 'groq' | 'local' | 'meai';
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class NexusConfigError extends Error {}

// v3.4.3 — los errores que SUBEN nunca llevan el cuerpo crudo del
// proveedor: ese cuerpo puede ser una página HTML completa (un 524 de
// Cloudflare le llegó tal cual al usuario en el chat, 2026-11-26). El
// detalle se registra en el servidor, donde sirve para diagnosticar,
// y el error que viaja solo dice qué pasó en lenguaje interno limpio.
function providerError(contexto: string, status: number, detail: string): Error {
  if (detail) console.error(`Calili: ${contexto} — estado ${status}: ${detail.slice(0, 500)}`);
  return new Error(`${contexto} respondió ${status}.`);
}

const GROQ_BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
const MEAI_BASE_URL = process.env.MEAI_BASE_URL || 'https://api.meai.cloud/v1';
export const DEFAULT_MEAI_MODEL = 'claude-sonnet-4.6';
// En ME AI la visión la atiende glm-5.2 (así lo enruta EditCoreAI con la
// misma llave); MEAI_VISION_MODEL permite cambiarlo sin tocar código.
export const MEAI_VISION_MODEL = process.env.MEAI_VISION_MODEL || 'glm-5.2';
// Groq retiro llama-4-scout (apagado el 2026-07-17 en planes free/developer:
// devolvia 404 model_not_found). La vision vive en la familia Qwen-VL; se
// prueban en orden hasta que uno responda, y VISION_MODEL puede anteponer
// un ID propio si Groq vuelve a mover el catalogo.
export const VISION_MODELS: string[] = [
  ...(process.env.VISION_MODEL ? [process.env.VISION_MODEL] : []),
  'qwen/qwen3.8-27b',
  'qwen/qwen3.6-27b',
  'qwen/qwen3-vl-32b-instruct',
];
export const VISION_MODEL = VISION_MODELS[0];
export const DEFAULT_NEXUS_MODEL = 'openai/gpt-oss-120b';
const FIRST_TOKEN_TIMEOUT_MS = 20000;

export function resolveProviders(env: NodeJS.ProcessEnv = process.env): NexusProvider[] {
  const meai: NexusProvider | null = env.MEAI_API_KEY
    ? {
        id: 'meai',
        baseUrl: MEAI_BASE_URL.replace(/\/+$/, ''),
        apiKey: env.MEAI_API_KEY,
        model: env.MEAI_MODEL || DEFAULT_MEAI_MODEL,
      }
    : null;

  const groq: NexusProvider | null = env.GROQ_API_KEY
    ? {
        id: 'groq',
        baseUrl: GROQ_BASE_URL,
        apiKey: env.GROQ_API_KEY,
        model: env.NEXUS_MODEL || DEFAULT_NEXUS_MODEL,
      }
    : null;

  const local: NexusProvider | null = env.NEXUS_LOCAL_URL
    ? {
        id: 'local',
        baseUrl: env.NEXUS_LOCAL_URL.replace(/\/+$/, ''),
        apiKey: env.NEXUS_LOCAL_API_KEY || 'local-no-key',
        model: env.NEXUS_LOCAL_MODEL || 'nexus',
      }
    : null;

  const byPriority = [meai, groq, local].filter((p): p is NexusProvider => p !== null);
  const primary = env.NEXUS_PRIMARY;
  if (primary) {
    const idx = byPriority.findIndex((p) => p.id === primary);
    if (idx > 0) {
      const [chosen] = byPriority.splice(idx, 1);
      byPriority.unshift(chosen);
    }
  }
  return byPriority;
}

// ¿Hay algún motor de chat configurado? Las rutas lo usan para decidir si
// las pasadas de herramientas corren (antes miraban solo GROQ_API_KEY y
// con ME AI como principal las herramientas habrían quedado apagadas).
export function chatProviderAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveProviders(env).length > 0;
}

// Ante un 429 (limite de velocidad del nivel de Groq), el propio error
// dice cuantos segundos esperar: se espera ESE tiempo y se reintenta una
// vez, en vez de mostrarle el error crudo al usuario.
function retryDelayMs(detail: string): number {
  const match = /try again in\s+([0-9]+(?:\.[0-9]+)?)\s*s/i.exec(detail);
  const seconds = match ? Number(match[1]) : 5;
  return Math.min(Math.max(seconds, 1), 25) * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function* streamFromProvider(
  provider: NexusProvider,
  messages: NexusMessage[],
  maxTokens: number,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const doFetch = () => fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      stream: true,
      max_completion_tokens: maxTokens,
    }),
    signal,
  });


  let response = await doFetch();
  if (response.status === 429) {
    const detail = await response.text().catch(() => '');
    await sleep(retryDelayMs(detail));
    response = await doFetch();
  }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw providerError(`El motor NEXUS (${provider.id})`, response.status, detail);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (typeof content === 'string' && content) yield content;
      } catch {
        // Línea parcial o de control: se ignora.
      }
    }
  }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

// Transmite la respuesta del modelo. Si un proveedor falla antes del primer
// token, cae al siguiente. Si ya entregó contenido, el error se propaga.
export async function* streamNexusChat(
  messages: NexusMessage[],
  options: { maxTokens?: number; signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  const providers = resolveProviders();
  if (providers.length === 0) {
    throw new NexusConfigError(
      'NEXUS no está configurado: falta MEAI_API_KEY (principal), GROQ_API_KEY (respaldo) o NEXUS_LOCAL_URL (local). Revisa tu archivo .env.',
    );
  }

  const maxTokens = options.maxTokens ?? 4096;
  let lastError: unknown;

  for (const provider of providers) {
    let delivered = false;
    try {
      const iterator = streamFromProvider(provider, messages, maxTokens, options.signal)[
        Symbol.asyncIterator
      ]();
      // Guarda de primer token: si el proveedor no arranca a tiempo, se corta
      // y se intenta el siguiente.
      let waitingFirst = true;
      while (true) {
        const nextPromise = iterator.next();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const result = waitingFirst
          ? await Promise.race([
              nextPromise,
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                  void iterator.return(undefined).catch(() => undefined);
                  reject(new Error(`El motor NEXUS (${provider.id}) tardó demasiado en arrancar.`));
                }, FIRST_TOKEN_TIMEOUT_MS);
              }),
            ]).finally(() => { if (timer) clearTimeout(timer); })
          : await nextPromise;
        waitingFirst = false;
        if (result.done) break;
        delivered = true;
        yield result.value;
      }
      return; // Respuesta completa de este proveedor.
    } catch (error) {
      if (delivered) throw error;
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('NEXUS no respondió.');
}

// ---------------------------------------------------------------------------
// Fase 3: herramientas y visión (proveedor principal; el local no las tiene)
// ---------------------------------------------------------------------------

export interface NexusToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface NexusCompletion {
  content: string;
  toolCalls: NexusToolCall[];
  finishReason?: string;
}

// El proveedor que atiende herramientas, resúmenes y (si es ME AI) la
// visión: el primero de la lista resuelta (ME AI si hay llave, si no Groq).
function primaryProvider(): NexusProvider {
  const providers = resolveProviders();
  const primary = providers[0];
  if (!primary) {
    throw new NexusConfigError(
      'Esta función requiere el motor: falta MEAI_API_KEY o GROQ_API_KEY. Revisa tu archivo .env.',
    );
  }
  return primary;
}

// Llamada sin streaming con herramientas (function calling). Devuelve el
// contenido o las llamadas a herramientas que el modelo decidió hacer.
export async function completeWithTools(
  messages: unknown[],
  tools: unknown[],
  signal?: AbortSignal,
): Promise<NexusCompletion> {
  const provider = primaryProvider();
  const doFetch = () => fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      tools,
      tool_choice: 'auto',
      stream: false,
      max_completion_tokens: 1536,
    }),
    signal: signal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([signal, AbortSignal.timeout(90_000)])
      : (signal ?? AbortSignal.timeout(90_000)),
  });


  let response = await doFetch();
  if (response.status === 429) {
    const detail = await response.text().catch(() => '');
    await sleep(retryDelayMs(detail));
    response = await doFetch();
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw providerError(`El motor NEXUS (${provider.id})`, response.status, detail);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message ?? {};
  return {
    content: typeof message.content === 'string' ? message.content : '',
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
    finishReason: typeof data.choices?.[0]?.finish_reason === 'string' ? data.choices[0].finish_reason : undefined,
  };
}

// Resumen rodante de la parte antigua de una conversación larga: el
// historial visible del usuario nunca se toca; esto es solo lo que el
// modelo recibe a cambio de los mensajes que ya no caben en contexto.
export async function summarizeHistory(previousSummary: string, transcript: string): Promise<string> {
  const provider = primaryProvider();
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        {
          role: 'system',
          content:
            'Resume en español, en máximo 220 palabras y en tercera persona, la parte de una conversación que se le entrega. Conserva hechos, nombres, cifras, decisiones, acuerdos y temas pendientes; descarta saludos y relleno. Si ya hay un resumen anterior, fúndelo con lo nuevo en un solo resumen coherente.',
        },
        {
          role: 'user',
          content: (previousSummary ? `RESUMEN ANTERIOR:\n${previousSummary}\n\n` : '') + `MENSAJES A RESUMIR:\n${transcript}`,
        },
      ],
      stream: false,
      max_completion_tokens: 700,
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw providerError('No se pudo resumir el historial', response.status, detail);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('Resumen vacío.');
  return content.trim();
}


// Streaming desde el modelo de visión. Con llave de ME AI manda glm-5.2
// por ME AI (así lo enruta EditCoreAI), con la cadena de visión de Groq
// como RESPALDO REAL (v3.4.3): antes, con ME AI presente, cualquier
// error suyo que no fuera 404 mataba el turno — un 524 (timeout de
// Cloudflare) dejó a Luis sin respuesta y con el HTML crudo en el
// chat. Ahora: 404 model_not_found prueba el siguiente modelo de la
// misma cadena; 429, 5xx o error de red saltan al siguiente PROVEEDOR;
// 401/403 se reportan (limpios) porque son de credenciales. Los
// mensajes llevan partes de texto e imagen (image_url con data:).
export async function* streamVisionChat(
  messages: unknown[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const providers = resolveProviders();
  const meai = providers.find((p) => p.id === 'meai');
  const groq = providers.find((p) => p.id === 'groq');
  const chains: Array<{ provider: NexusProvider; models: string[] }> = [];
  if (meai) chains.push({ provider: meai, models: [MEAI_VISION_MODEL] });
  if (groq) chains.push({ provider: groq, models: VISION_MODELS });
  if (chains.length === 0) {
    throw new NexusConfigError(
      'Esta función requiere el motor de visión: falta MEAI_API_KEY o GROQ_API_KEY. Revisa tu archivo .env.',
    );
  }
  let response: Response | null = null;
  let lastStatus = 0;
  let lastError: unknown;
  chainLoop:
  for (const chain of chains) {
    for (const model of chain.models) {
      let attempt: Response;
      try {
        attempt = await fetch(`${chain.provider.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${chain.provider.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            max_completion_tokens: 2048,
          }),
          signal,
        });
      } catch (error) {
        // Error de red o timeout contra este proveedor: se prueba el
        // siguiente. (Un aborto del cliente NO es esto si trae señal:
        // si la señal ya abortó, se propaga tal cual.)
        if (signal?.aborted) throw error;
        console.error(`Calili: visión — red falló contra ${chain.provider.id}, se prueba el respaldo`, error);
        lastError = error;
        continue chainLoop;
      }
      if (attempt.ok && attempt.body) {
        response = attempt;
        break chainLoop;
      }
      lastStatus = attempt.status;
      const detail = await attempt.text().catch(() => '');
      if (attempt.status === 404 && detail.includes('model_not_found')) {
        console.error(`Calili: visión — modelo ${model} no existe en ${chain.provider.id}, se prueba el siguiente`);
        continue;
      }
      if (attempt.status === 429 || attempt.status >= 500) {
        console.error(`Calili: visión — ${chain.provider.id} respondió ${attempt.status}, se prueba el respaldo. Detalle: ${detail.slice(0, 300)}`);
        lastError = providerError('El modelo de visión', attempt.status, '');
        continue chainLoop;
      }
      // 401/403 y demás 4xx: credenciales o petición — se reporta
      // limpio, sin pegar el cuerpo del proveedor.
      throw providerError('El modelo de visión', attempt.status, detail);
    }
  }
  if (!response || !response.body) {
    if (lastError instanceof Error) throw lastError;
    throw new Error(`Ningún modelo de visión respondió (último estado ${lastStatus}). El proveedor pudo haber retirado el modelo actual; avísale a Luis para actualizar el ID.`);
  }


  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (typeof content === 'string' && content) yield content;
      } catch {
        // Línea parcial o de control: se ignora.
      }
    }
  }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
