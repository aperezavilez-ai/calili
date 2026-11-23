'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, MicOff } from 'lucide-react';
import { useChatStore } from '@/store/chat-store';
import { useSettingsStore } from '@/store/settings-store';
import { normalizeCaliliResponse } from '@/lib/response-policy';
export interface GeneratedFile { id: string; name: string; mime: string; base64: string }

type Phase = 'listening' | 'thinking' | 'speaking' | 'error';

interface VoiceModeProps {
  onClose: () => void;
  onFile: (file: GeneratedFile) => void;
}

function plainForSpeech(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !line.trim().startsWith('|'))
    .join(' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_`>~]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]+["»)]?|\S[^.!?…]*$/g) || [text];
  return parts.map((p) => p.trim()).filter((p) => p.length > 1);
}

export default function VoiceMode({ onClose, onFile }: VoiceModeProps) {
  const [phase, setPhase] = useState<Phase>('listening');
  const [caption, setCaption] = useState('Te escucho…');
  const [level, setLevel] = useState(0);
  const openRef = useRef(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);

  const stopTracks = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch { /* ya detenido */ }
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  const speakWithBrowser = useCallback((text: string) => new Promise<void>((resolve) => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'es-MX';
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith('es') && /dalia|paulina|female|mujer/i.test(v.name))
      || window.speechSynthesis.getVoices().find((v) => v.lang.startsWith('es'));
    if (voice) utter.voice = voice;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    window.speechSynthesis.speak(utter);
  }), []);

  const speak = useCallback(async (text: string) => {
    const clean = plainForSpeech(text);
    if (!clean) return;
    const sentences = splitSentences(clean).slice(0, 8);
    for (const sentence of sentences) {
      if (!openRef.current) return;
      try {
        const res = await fetch('/api/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: sentence }),
        });
        if (!res.ok) throw new Error('speak');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        await new Promise<void>((resolve) => {
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          void audio.play().catch(() => resolve());
        });
      } catch {
        await speakWithBrowser(sentence);
      }
    }
  }, [speakWithBrowser]);

  const askCalili = useCallback(async (userText: string): Promise<string> => {
    const store = useChatStore.getState();
    let conversationId = store.currentConversationId;
    if (!conversationId) conversationId = store.createConversation();
    store.addMessage(conversationId, { role: 'user', content: userText });

    const state = useChatStore.getState();
    const conversation = state.conversations.find((c) => c.id === conversationId);
    const history = (conversation?.messages || []).slice(-20).map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, model: useSettingsStore.getState().selectedModel }),
    });
    if (!res.ok || !res.body) throw new Error('chat');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const event of events) {
        const line = event.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.file) onFile(parsed.file as GeneratedFile);
          if (parsed.content) full += parsed.content;
          if (parsed.error) throw new Error(parsed.error);
        } catch (err) {
          if (err instanceof SyntaxError) continue;
          throw err;
        }
      }
    }
    const reply = normalizeCaliliResponse(full.trim());
    if (!reply) throw new Error('respuesta vacia');
    useChatStore.getState().addMessage(conversationId, { role: 'assistant', content: reply });
    return reply;
  }, [onFile]);

  const listenOnce = useCallback(async () => {
    if (!openRef.current) return;
    setPhase('listening');
    setCaption('Te escucho…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!openRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let heardSpeech = false;
      let silenceSince = 0;
      const startedAt = Date.now();

      const tick = () => {
        if (!openRef.current) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(1, rms * 4));
        const now = Date.now();
        if (rms > 0.025) { heardSpeech = true; silenceSince = 0; }
        else if (heardSpeech) { if (!silenceSince) silenceSince = now; }
        const silenceLong = heardSpeech && silenceSince > 0 && now - silenceSince > 1400;
        const tooLong = now - startedAt > 30000;
        if (silenceLong || tooLong) {
          if (recorder.state !== 'inactive') recorder.stop();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
      recorder.start(250);
      rafRef.current = requestAnimationFrame(tick);
      await stopped;
      cancelAnimationFrame(rafRef.current);
      void audioCtx.close().catch(() => undefined);
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setLevel(0);
      if (!openRef.current) return;

      if (!heardSpeech || chunks.length === 0) { void listenOnce(); return; }

      setPhase('thinking');
      setCaption('Pensando…');
      const form = new FormData();
      form.append('audio', new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), 'voz.webm');
      const tres = await fetch('/api/transcribe', { method: 'POST', body: form });
      const tdata = await tres.json().catch(() => ({}));
      const userText = String(tdata?.text || '').trim();
      if (!userText) { void listenOnce(); return; }
      setCaption(`Tú: ${userText}`);

      const reply = await askCalili(userText);
      if (!openRef.current) return;
      setPhase('speaking');
      setCaption(reply.length > 220 ? `${reply.slice(0, 220)}…` : reply);
      await speak(reply);
      if (!openRef.current) return;
      void listenOnce();
    } catch (err) {
      if (!openRef.current) return;
      setPhase('error');
      setCaption('No pude usar el micrófono o falló la conexión. Toca la orbe para reintentar.');
    }
  }, [askCalili, speak]);

  useEffect(() => {
    openRef.current = true;
    void listenOnce();
    return () => { openRef.current = false; stopTracks(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => { openRef.current = false; stopTracks(); onClose(); };
  const handleOrbTap = () => { if (phase === 'error') void listenOnce(); };

  const orbScale = phase === 'listening' ? 1 + level * 0.25 : phase === 'speaking' ? 1.06 : 1;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0b0b12]/97 backdrop-blur-sm">
      <button
        onClick={handleClose}
        className="absolute right-5 top-5 rounded-full border border-white/15 bg-white/5 p-2.5 text-white/70 hover:bg-white/10 hover:text-white"
        title="Cerrar modo voz"
        aria-label="Cerrar modo voz"
      >
        <X className="h-5 w-5" />
      </button>

      <button onClick={handleOrbTap} className="relative grid place-items-center rounded-full" aria-label="Orbe de voz de Calili">
        <span className={`absolute h-64 w-64 rounded-full bg-fuchsia-500/20 blur-2xl ${phase === 'listening' ? 'animate-ping' : ''}`} style={{ animationDuration: '2.4s' }} />
        <span
          className="relative block h-52 w-52 rounded-full shadow-[0_0_80px_rgba(217,70,180,0.45)] transition-transform duration-150"
          style={{
            transform: `scale(${orbScale})`,
            background: 'conic-gradient(from 120deg, #f59e0b, #ec4899, #8b5cf6, #06b6d4, #f59e0b)',
            animation: phase === 'thinking' ? 'calili-spin 3.2s linear infinite' : 'calili-breathe 4.5s ease-in-out infinite',
          }}
        >
          <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.55),rgba(255,255,255,0)_55%)]" />
        </span>
      </button>

      <p className="mt-10 flex items-center gap-2 text-sm uppercase tracking-[0.25em] text-white/50">
        {phase === 'listening' && 'Escuchando'}
        {phase === 'thinking' && 'Pensando'}
        {phase === 'speaking' && 'Calili está hablando'}
        {phase === 'error' && <><MicOff className="h-4 w-4" /> Algo falló</>}
      </p>
      <p className="mt-3 max-w-xl px-6 text-center text-lg leading-relaxed text-white/90">{caption}</p>
      <p className="mt-8 px-6 text-center text-xs text-white/35">Toca la X para salir. La conversación también queda escrita en tu chat.</p>

      <style jsx global>{`
        @keyframes calili-breathe { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.18); } }
        @keyframes calili-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
