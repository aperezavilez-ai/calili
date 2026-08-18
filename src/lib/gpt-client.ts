export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string };
  }>;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  model?: string;
  providerId?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  signal?: AbortSignal;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

class GPTClient {
  private apiUrl: string;
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiUrl = process.env.GPT_API_URL || '';
    this.apiKey = process.env.GPT_API_KEY || '';
    // El Gateway selecciona el modelo por proveedor y puede cambiar al fallback.
    this.model = process.env.GPT_MODEL || '';
  }

  private validateConfig() {
    if (!this.apiUrl) throw new Error('GPT_API_URL no está configurada');
    if (!this.apiKey) throw new Error('GPT_API_KEY no está configurada');
  }

  private async getError(response: Response): Promise<string> {
    const body = await response.text();
    try {
      const parsed = JSON.parse(body);
      return parsed.error?.message || parsed.message || body;
    } catch {
      return body || 'Error al comunicarse con GPT API';
    }
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.validateConfig();
    const { providerId, signal, ...payload } = request;
    const requestBody = {
      ...payload,
      ...(this.model ? { model: this.model } : {}),
      temperature: request.temperature || 0.7,
      max_tokens: request.max_tokens || 1200,
    };
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...(providerId ? { 'x-provider-id': providerId } : {}),
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      throw new Error(await this.getError(response));
    }

    return response.json();
  }

  async *chatStream(request: ChatCompletionRequest): AsyncGenerator<string, void, unknown> {
    this.validateConfig();
    const { providerId, signal, ...payload } = request;
    const requestBody = {
      ...payload,
      stream: true,
      ...(this.model ? { model: this.model } : {}),
      temperature: request.temperature || 0.7,
      max_tokens: request.max_tokens || 1200,
    };
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...(providerId ? { 'x-provider-id': providerId } : {}),
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      throw new Error(await this.getError(response));
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No se pudo leer la respuesta');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch (e) {
            console.error('Error parsing SSE:', e);
          }
        }
      }
    }
  }
}

export const gptClient = new GPTClient();
