import { NextRequest } from 'next/server';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export const runtime = 'nodejs';
export const maxDuration = 30;

const VOICE = process.env.CALILI_VOICE || 'es-MX-DaliaNeural';
const MAX_CHARS = 700;

async function edgeTts(text: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text.slice(0, MAX_CHARS));
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('edge timeout')), 9000);
    audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    audioStream.on('end', () => { clearTimeout(timer); resolve(); });
    audioStream.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
  });
  const audio = Buffer.concat(chunks);
  if (audio.length < 200) throw new Error('edge audio vacio');
  return audio;
}

function googleChunks(text: string): string[] {
  const clean = text.slice(0, MAX_CHARS);
  const sentences = clean.match(/[^.!?…]+[.!?…]+["»)]?|\S[^.!?…]*$/g) || [clean];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if ((current + ' ' + piece).trim().length <= 180) {
      current = (current + ' ' + piece).trim();
    } else {
      if (current) chunks.push(current);
      current = piece.slice(0, 180);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function googleTts(text: string): Promise<Buffer> {
  const parts: Buffer[] = [];
  for (const chunk of googleChunks(text)) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=es&client=tw-ob&q=${encodeURIComponent(chunk)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`google tts ${res.status}`);
    parts.push(Buffer.from(await res.arrayBuffer()));
  }
  const audio = Buffer.concat(parts);
  if (audio.length < 200) throw new Error('google audio vacio');
  return audio;
}

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
    const audio = await edgeTts(text);
    return new Response(new Uint8Array(audio), {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice-Engine': 'edge-dalia' },
    });
  } catch {
    try {
      const audio = await googleTts(text);
      return new Response(new Uint8Array(audio), {
        headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice-Engine': 'google' },
      });
    } catch (err: any) {
      return Response.json({ error: `Voz no disponible: ${err?.message || 'error'}` }, { status: 502 });
    }
  }
}
