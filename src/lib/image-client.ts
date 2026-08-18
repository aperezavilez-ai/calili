export interface ImageGenerationRequest {
  prompt: string;
  size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
  quality?: 'standard' | 'hd';
  n?: number;
}

export interface ImageGenerationResponse {
  created: number;
  data: {
    url: string;
    revised_prompt?: string;
  }[];
}

class ImageClient {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = process.env.GPT_API_URL?.replace('/chat/completions', '/images/generations') || '';
    this.apiKey = process.env.GPT_API_KEY || '';
  }

  private async getError(response: Response): Promise<string> {
    const body = await response.text();
    try {
      const parsed = JSON.parse(body);
      return parsed.error?.message || parsed.message || body;
    } catch {
      return body || 'Error al generar imagen';
    }
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    if (!this.apiUrl) throw new Error('El proveedor de imágenes no está configurado.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          prompt: request.prompt,
          size: request.size || '1024x1024',
          quality: request.quality || 'standard',
          n: request.n || 1,
          model: 'dall-e-3',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await this.getError(response));
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const imageClient = new ImageClient();
