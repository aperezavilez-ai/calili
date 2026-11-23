import { NextRequest, NextResponse } from 'next/server';

// Dictado por voz con Whisper servido por Groq (el mismo proveedor y la
// misma clave que el chat). Sustituye al reconocimiento del navegador,
// que transcribía enredado.
export const runtime = 'nodejs';

const GROQ_BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'whisper-large-v3-turbo';
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'El dictado no está configurado: falta GROQ_API_KEY.' },
      { status: 503 },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'No llegó audio para transcribir.' }, { status: 400 });
  }

  try {
    const audio = formData.get('audio');
    if (!(audio instanceof Blob) || audio.size === 0) {
      return NextResponse.json({ error: 'No llegó audio para transcribir.' }, { status: 400 });
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: 'El audio es demasiado largo. Dicta en partes más cortas.' }, { status: 413 });
    }

    const upstream = new FormData();
    upstream.append('file', audio, 'dictado.webm');
    upstream.append('model', WHISPER_MODEL);
    upstream.append('language', 'es');
    upstream.append('response_format', 'verbose_json');

    const response = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return NextResponse.json(
        { error: `Whisper respondió ${response.status}. ${detail.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const data = await response.json();
    // Anti-alucinacion: Whisper inventa frases (a veces preguntas enteras)
    // cuando el audio es silencio o ruido. verbose_json trae la
    // probabilidad de "no hay voz" por segmento: se descartan los
    // segmentos dudosos y, si todo era ruido, no se devuelve texto.
    const segments = Array.isArray(data?.segments) ? data.segments : null;
    if (segments) {
      const kept = segments
        .filter((seg: { no_speech_prob?: number }) => typeof seg?.no_speech_prob !== 'number' || seg.no_speech_prob <= 0.6)
        .map((seg: { text?: string }) => String(seg?.text ?? ''))
        .join('')
        .trim();
      return NextResponse.json({ text: kept });
    }
    return NextResponse.json({ text: typeof data.text === 'string' ? data.text.trim() : '' });
  } catch {
    return NextResponse.json({ error: 'No se pudo transcribir el audio.' }, { status: 500 });
  }
}
