import { NextRequest } from 'next/server';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export const runtime = 'nodejs';
export const maxDuration = 30;

const VOICE = process.env.CALILI_VOICE || 'es-MX-DaliaNeural';
const MAX_CHARS = 700;

export async function POST(req: NextRequest) {
  let text = '';
  try {
    const body = await req.json();
    text = String(body?.text || '').trim();
  } catch {
    return Response.json({ error: 'JSON invalido' }, { status: 400 });
  }
  if (!text) {
    return Response.json({ error: 'Falta el texto a leer' }, { status: 400 });
  }

  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text.slice(0, MAX_CHARS));
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 20000);
      audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
      audioStream.on('end', () => { clearTimeout(timer); resolve(); });
      audioStream.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
    });
    const audio = Buffer.concat(chunks);
    if (audio.length < 200) throw new Error('audio vacio');
    return new Response(new Uint8Array(audio), {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return Response.json({ error: `Voz no disponible: ${err?.message || 'error'}` }, { status: 502 });
  }
}
