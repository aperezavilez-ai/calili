// Cliente del servicio de avatar (LongCat-Video-Avatar auto-hospedado en
// una maquina con GPU). Calili le manda la foto + la narracion ya
// sintetizada (+ la musica de fondo si se pidio) y el servicio devuelve
// el MP4 final con los labios sincronizados y la mezcla hecha (ffmpeg).
// Se activa con AVATAR_SERVICE_URL; sin esa variable, la capacidad no
// se anuncia. AVATAR_SERVICE_TOKEN es un bearer simple compartido.
import type { GeneratedFile } from '@/lib/file-generator';

export function avatarServiceUrl(): string | null {
  const url = process.env.AVATAR_SERVICE_URL?.trim();
  return url ? url.replace(/\/+$/, '') : null;
}

export async function createTalkingVideo(input: {
  imageDataUrl: string;
  audioBase64: string;
  audioMime: string;
  musicBase64?: string;
  musicMime?: string;
}): Promise<{ file: GeneratedFile }> {
  const base = avatarServiceUrl();
  if (!base) throw new Error('El servicio de avatar no esta configurado.');

  const response = await fetch(`${base}/talking-video`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.AVATAR_SERVICE_TOKEN
        ? { Authorization: `Bearer ${process.env.AVATAR_SERVICE_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(input),
    // El avatar tarda minutos en una GPU buena; el tope real lo pone la
    // ruta (maxDuration 300), asi que el cliente espera casi todo eso.
    signal: AbortSignal.timeout(280_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`El servicio de avatar respondio ${response.status}. ${detail.slice(0, 200)}`);
  }
  const data = (await response.json()) as { base64?: string; mime?: string };
  if (!data.base64) throw new Error('El servicio de avatar no devolvio video.');
  return {
    file: {
      name: 'video-hablado.mp4',
      mime: data.mime || 'video/mp4',
      base64: data.base64,
    },
  };
}
