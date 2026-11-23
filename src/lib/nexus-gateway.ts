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

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
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
