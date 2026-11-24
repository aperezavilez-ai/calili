// Sintesis de voz reutilizable (la misma voz Dalia de /api/speak) para
// las herramientas que necesitan narracion, como el video hablado.
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const EDGE_VOICE = 'es-MX-DaliaNeural';
const MAX_CHARS = 1200; // ~45-60 segundos de voz: el clip del avatar es corto

export async function synthesizeNarration(text: string): Promise<{ base64: string; mime: string }> {
  const clean = text.trim().slice(0, MAX_CHARS);
  if (!clean) throw new Error('El guion de la narracion llego vacio.');
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(EDGE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(clean, { rate: 0.94 });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('La voz tardo demasiado.')), 30000);
      audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
      audioStream.on('end', () => { clearTimeout(timer); resolve(); });
      audioStream.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
    });
    const buffer = Buffer.concat(chunks);
    if (buffer.length === 0) throw new Error('La voz no devolvio audio.');
    return { base64: buffer.toString('base64'), mime: 'audio/mpeg' };
  } finally {
    try { tts.close(); } catch { /* el websocket ya cerro */ }
  }
}
