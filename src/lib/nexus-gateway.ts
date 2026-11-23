// Pasarela NEXUS de Calili.
// Un solo punto de salida hacia el modelo. Ningún proveedor queda cableado
// en las rutas ni en la interfaz: todo se decide por variables de entorno.
//
// Proveedores (API compatible con OpenAI, /chat/completions):
//   - groq  : producción. Requiere GROQ_API_KEY. Modelo: NEXUS_MODEL
//             (por defecto openai/gpt-oss-120b).
//   - local : desarrollo / respaldo en la PC de Luis. Solo se activa si
//             NEXUS_LOCAL_URL está definida (p. ej. http://127.0.0.1:11434/v1
//             para Ollama o http://127.0.0.1:1234/v1 para LM Studio).
//             Modelo: NEXUS_LOCAL_MODEL. Clave opcional: NEXUS_LOCAL_API_KEY.
//
// Orden: NEXUS_PRIMARY=groq|local (por defecto groq). Si el proveedor
// primario falla ANTES de entregar el primer token, se intenta el siguiente.

export interface NexusMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface NexusProvider {
  id: 'groq' | 'local';
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class NexusConfigError extends Error {}

const GROQ_BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
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

  const ordered = env.NEXUS_PRIMARY === 'local' ? [local, groq] : [groq, local];
  return ordered.filter((p): p is NexusProvider => p !== null);
}

async function* streamFromProvider(
  provider: NexusProvider,
  messages: NexusMessage[],
  maxTokens: number,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
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

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw new Error(`El motor NEXUS (${provider.id}) respondió ${response.status}. ${detail.slice(0, 300)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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
      'NEXUS no está configurado: falta GROQ_API_KEY (producción) o NEXUS_LOCAL_URL (local). Revisa tu archivo .env.',
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
        const result = waitingFirst
          ? await Promise.race([
              nextPromise,
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error(`El motor NEXUS (${provider.id}) tardó demasiado en arrancar.`)),
                  FIRST_TOKEN_TIMEOUT_MS,
                ),
              ),
            ])
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
// Fase 3: herramientas y visión (solo Groq: el proveedor local no las tiene)
// ---------------------------------------------------------------------------

export interface NexusToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface NexusCompletion {
  content: string;
  toolCalls: NexusToolCall[];
}

function groqProvider(): NexusProvider {
  const providers = resolveProviders();
  const groq = providers.find((p) => p.id === 'groq');
  if (!groq) {
    throw new NexusConfigError(
      'Esta función requiere el motor en Groq: falta GROQ_API_KEY. Revisa tu archivo .env.',
    );
  }
  return groq;
}

// Llamada sin streaming con herramientas (function calling). Devuelve el
// contenido o las llamadas a herramientas que el modelo decidió hacer.
export async function completeWithTools(
  messages: unknown[],
  tools: unknown[],
  signal?: AbortSignal,
): Promise<NexusCompletion> {
  const provider = groqProvider();
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
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
      max_completion_tokens: 4096,
    }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`El motor NEXUS (groq) respondió ${response.status}. ${detail.slice(0, 300)}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message ?? {};
  return {
    content: typeof message.content === 'string' ? message.content : '',
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
  };
}

// Resumen rodante de la parte antigua de una conversación larga: el
// historial visible del usuario nunca se toca; esto es solo lo que el
// modelo recibe a cambio de los mensajes que ya no caben en contexto.
export async function summarizeHistory(previousSummary: string, transcript: string): Promise<string> {
  const provider = groqProvider();
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
    throw new Error(`No se pudo resumir el historial (${response.status}). ${detail.slice(0, 200)}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('Resumen vacío.');
  return content.trim();
}


// Streaming desde el modelo de visión (Llama 4 Scout en Groq). Los mensajes
// llevan partes de texto e imagen (image_url con data: en base64).
export async function* streamVisionChat(
  messages: unknown[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const provider = groqProvider();
  let response: Response | null = null;
  let lastStatus = 0;
  for (const model of VISION_MODELS) {
    const attempt = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_completion_tokens: 2048,
      }),
      signal,
    });
    if (attempt.ok && attempt.body) {
      response = attempt;
      break;
    }
    lastStatus = attempt.status;
    const detail = await attempt.text().catch(() => '');
    // Solo se prueba el siguiente modelo si este no existe; otro error
    // (401, 429, 500) se reporta tal cual.
    if (attempt.status !== 404 || !detail.includes('model_not_found')) {
      throw new Error(`El modelo de visión respondió ${attempt.status}. ${detail.slice(0, 300)}`);
    }
  }
  if (!response || !response.body) {
    throw new Error(`Ningún modelo de visión de Groq respondió (último estado ${lastStatus}). Groq pudo haber retirado el modelo actual; avísale a Luis para actualizar el ID.`);
  }


  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
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
}
