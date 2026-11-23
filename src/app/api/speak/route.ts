import { NextRequest } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export const runtime = 'nodejs';
export const maxDuration = 60;

const EDGE_VOICE = process.env.CALILI_VOICE || 'es-MX-DaliaNeural';
const OPENAI_VOICE = process.env.CALILI_OPENAI_VOICE || 'shimmer';
const MAX_CHARS = 900;

async function openaiTts(text: string): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('sin clave openai');
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: OPENAI_VOICE,
      input: text.slice(0, MAX_CHARS),
      response_format: 'mp3',
      instructions: 'Habla en español latinoamericano neutro, con tono cálido, natural y conversacional, como una asistente cercana. Ritmo fluido, sin pausas artificiales.',
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`openai tts ${res.status}`);
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length < 200) throw new Error('openai audio vacio');
  return audio;
}

async function edgeTts(text: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(EDGE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text.slice(0, MAX_CHARS), { rate: 0.94 });
  const chunks: Buffer[] = [];
  try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('edge timeout')), 12000);
    audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    audioStream.on('end', () => { clearTimeout(timer); resolve(); });
    audioStream.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
  });
  const audio = Buffer.concat(chunks);
  if (audio.length < 200) throw new Error('edge audio vacio');
  return audio;
  } finally {
    (tts as unknown as { close?: () => void }).close?.();
  }
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
  const apiUser = await requireApiUser(req);
  if (!apiUser) {
    return Response.json({ error: 'Inicia sesión para usar Calili.' }, { status: 401 });
  }
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

  const engines: Array<{ name: string; run: (t: string) => Promise<Buffer> }> = [
    { name: 'openai', run: openaiTts },
    { name: 'edge-dalia', run: edgeTts },
    { name: 'google', run: googleTts },
  ];
  let lastError = 'sin motores';
  for (const engine of engines) {
    try {
      const audio = await engine.run(text);
      return new Response(new Uint8Array(audio), {
        headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice-Engine': engine.name },
      });
    } catch (err: any) {
      lastError = err?.message || engine.name;
    }
  }
  return Response.json({ error: 'La voz no está disponible en este momento.' }, { status: 502 });
}
