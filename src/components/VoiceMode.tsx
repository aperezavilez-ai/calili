'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Mic, MicOff } from 'lucide-react';
import { useChatStore } from '@/store/chat-store';
import { useSettingsStore } from '@/store/settings-store';
import { normalizeCaliliResponse } from '@/lib/response-policy';
import { playEarcon } from '@/lib/earcons';
import { loadMemoryFacts, saveMemoryFact, removeMemoryFact } from '@/lib/memory-facts';
import { apiFetch } from '@/lib/api-client';

export interface GeneratedFile { id: string; name: string; mime: string; base64: string }

type Phase = 'listening' | 'thinking' | 'speaking' | 'error';

interface VoiceModeProps {
  onClose: () => void;
  onFile: (file: GeneratedFile) => void;
}

const MALE_VOICE = /pablo|jorge|raul|raúl|david|carlos|miguel|diego|juan|masculin|male\b|hombre/i;
const FEMALE_VOICE = /dalia|paulina|sabina|elena|elvira|ximena|lucia|lucía|helena|laura|maria|maría|female|mujer|google español/i;

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

export default function VoiceMode({ onClose, onFile }: VoiceModeProps) {
  const [phase, setPhase] = useState<Phase>('listening');
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const cancelPlayRef = useRef<(() => void) | null>(null);
  const openRef = useRef(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);
  const queueRef = useRef<Array<{ text: string; audio: Promise<Blob | null> }>>([]);
  const pumpingRef = useRef(false);
  const streamDoneRef = useRef(false);
  const turnDoneRef = useRef<(() => void) | null>(null);
  const speakCueRef = useRef(false);
  const factsRef = useRef<string[]>([]);
  const lastReplyRef = useRef('');
  const errorsRef = useRef(0);

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
    queueRef.current = [];
  }, []);

  const fetchSpeakAudio = useCallback((text: string): Promise<Blob | null> => {
    return apiFetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then((res) => (res.ok ? res.blob() : null))
      .catch(() => null);
  }, []);

  const speakWithBrowser = useCallback((text: string) => new Promise<void>((resolve) => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'es-MX';
    const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('es'));
    const voice = voices.find((v) => FEMALE_VOICE.test(v.name))
      || voices.find((v) => !MALE_VOICE.test(v.name))
      || voices[0];
    if (voice) utter.voice = voice;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    window.speechSynthesis.speak(utter);
  }), []);

  const pumpQueue = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    while (openRef.current && !mutedRef.current && queueRef.current.length > 0) {
      const item = queueRef.current.shift()!;
      if (!speakCueRef.current) { speakCueRef.current = true; playEarcon('speak'); }
      const blob = await item.audio;
      if (!openRef.current) break;
      if (blob) {
        // Se reutiliza SIEMPRE el mismo elemento de audio, desbloqueado con
        // el toque que abrio el modo voz: crear un Audio nuevo tras esperas
        // largas de red hace que el navegador bloquee la reproduccion en
        // silencio (la causa de que "no se escuchara" la voz).
        const url = URL.createObjectURL(blob);
        const played = await new Promise<boolean>((resolve) => {
          const audio = audioRef.current ?? new Audio();
          audioRef.current = audio;
          cancelPlayRef.current = () => { audio.pause(); URL.revokeObjectURL(url); resolve(true); };
          audio.onended = () => { cancelPlayRef.current = null; URL.revokeObjectURL(url); resolve(true); };
          audio.onerror = () => { cancelPlayRef.current = null; URL.revokeObjectURL(url); resolve(false); };
          audio.src = url;
          // El elemento persistente nacio con volume=0 (desbloqueo
          // silencioso al abrir): sin esta linea, la voz suena a cero.
          audio.volume = 1;
          audio.play().then(() => undefined).catch(() => resolve(false));
        });
        if (!played && openRef.current && !mutedRef.current) {
          // Si aun asi el navegador bloquea el audio, la voz del navegador
          // suena en su lugar: nunca quedarse mudo en silencio.
          await speakWithBrowser(item.text);
        }
      } else {
        await speakWithBrowser(item.text);
      }
    }
    pumpingRef.current = false;
    if (openRef.current && streamDoneRef.current && queueRef.current.length === 0) {
      const done = turnDoneRef.current;
      turnDoneRef.current = null;
      done?.();
    }
  }, [speakWithBrowser]);

  const enqueueSentence = useCallback((raw: string) => {
    const text = plainForSpeech(raw);
    if (text.length < 2) return;
    queueRef.current.push({ text, audio: fetchSpeakAudio(text) });
    setPhase('speaking');
    void pumpQueue();
  }, [fetchSpeakAudio, pumpQueue]);

  const askCalili = useCallback(async (userText: string): Promise<string> => {
    const store = useChatStore.getState();
    let conversationId = store.currentConversationId;
    if (!conversationId) conversationId = store.createConversation();
    store.addMessage(conversationId, { role: 'user', content: userText });

    const state = useChatStore.getState();
    const conversation = state.conversations.find((c) => c.id === conversationId);
    const history = (conversation?.messages || []).slice(-20).map((m) => ({ role: m.role, content: m.content }));

    const res = await apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, model: useSettingsStore.getState().selectedModel, voice: true, memory: factsRef.current }),
    });
    if (!res.ok || !res.body) throw new Error('chat');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    // Fluidez: se habla en maximo 2 bloques. La primera frase sale sola para
    // empezar rapido; TODO el resto se sintetiza en una sola pasada, con su
    // arco de prosodia completo (sin cortes frase a frase = sin robot).
    let firstBuffer = '';
    let firstSent = false;
    let restBuffer = '';
    const sentenceBoundary = /[.!?…]+["»)]?\s+/;

    const feedContent = (content: string) => {
      full += content;
      if (firstSent) { restBuffer += content; return; }
      firstBuffer += content;
      const match = sentenceBoundary.exec(firstBuffer);
      if (match) {
        const end = match.index + match[0].length;
        const sentence = firstBuffer.slice(0, end).trim();
        restBuffer += firstBuffer.slice(end);
        firstBuffer = '';
        firstSent = true;
        if (sentence) enqueueSentence(sentence);
      }
    };

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
          if (parsed.memory) {
            const userId = useChatStore.getState().dbUserId;
            const fact = String(parsed.memory.fact || '');
            const apply = parsed.memory.action === 'add' ? saveMemoryFact(userId, fact) : removeMemoryFact(userId, fact);
            void apply.then((facts) => { factsRef.current = facts; }).catch(() => undefined);
          }
          if (parsed.content) feedContent(String(parsed.content));
          if (parsed.error) throw new Error(parsed.error);
        } catch (err) {
          if (err instanceof SyntaxError) continue;
          throw err;
        }
      }
    }
    const remainder = (firstSent ? restBuffer : firstBuffer).trim();
    if (remainder) enqueueSentence(remainder);
    const reply = normalizeCaliliResponse(full.trim());
    if (!reply) throw new Error('respuesta vacia');
    lastReplyRef.current = reply;
    useChatStore.getState().addMessage(conversationId, { role: 'assistant', content: reply });
    return reply;
  }, [enqueueSentence, onFile]);

  const listenOnce = useCallback(async () => {
    if (!openRef.current || mutedRef.current) return;
    setPhase('listening');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
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
      let peakRms = 0;
      const startedAt = Date.now();

      const tick = () => {
        if (!openRef.current) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(1, rms * 4));
        const now = Date.now();
        if (rms > peakRms) peakRms = rms;
        // Ventana de gracia: los primeros 400 ms (el sonido de escucha y la
        // cola de eco de la respuesta anterior en la bocina) no cuentan
        // como voz; esa era la puerta de las transcripciones fantasma.
        if (now - startedAt < 400) { rafRef.current = requestAnimationFrame(tick); return; }
        if (rms > 0.025) { heardSpeech = true; silenceSince = 0; }
        else if (heardSpeech) { if (!silenceSince) silenceSince = now; }
        const silenceLong = heardSpeech && silenceSince > 0 && now - silenceSince > 800;
        const tooLong = now - startedAt > 30000;
        if (silenceLong || tooLong) {
          if (recorder.state !== 'inactive') recorder.stop();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
      const hardStop = window.setTimeout(() => {
        if (recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* ya detenido */ } }
      }, 32000);
      void stopped.then(() => window.clearTimeout(hardStop));
      recorder.start(250);
      playEarcon('listen');
      rafRef.current = requestAnimationFrame(tick);
      await stopped;
      cancelAnimationFrame(rafRef.current);
      void audioCtx.close().catch(() => undefined);
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setLevel(0);
      if (!openRef.current || mutedRef.current) return;

      if (!heardSpeech || chunks.length === 0) { void listenOnce(); return; }
      // Puerta de energia: si todo lo grabado fue bajito (ruido de cuarto,
      // television lejana), no se manda a transcribir: Whisper inventa
      // frases sobre ruido, y esas eran las "preguntas que yo no hice".
      if (peakRms < 0.05) { void listenOnce(); return; }

      setPhase('thinking');
      const form = new FormData();
      form.append('audio', new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), 'voz.webm');
      const tres = await apiFetch('/api/transcribe', { method: 'POST', body: form });
      const tdata = await tres.json().catch(() => ({}));
      const userText = String(tdata?.text || '').trim();
      if (!userText) { void listenOnce(); return; }
      errorsRef.current = 0;
      if (mutedRef.current) return;
      // Guardia anti-eco: si lo "escuchado" es en realidad la voz de
      // Calili rebotando de la bocina al microfono (su respuesta anterior
      // o un fragmento largo de ella), se descarta y se vuelve a escuchar.
      {
        const clean = (value: string) => value.toLowerCase().replace(/[^a-záéíóúñ0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
        const heardClean = clean(userText);
        const replyClean = clean(lastReplyRef.current);
        if (heardClean.length >= 12 && replyClean && (replyClean.includes(heardClean) || (replyClean.length >= 40 && heardClean.includes(replyClean.slice(0, 40))))) {
          void listenOnce();
          return;
        }
      }

      streamDoneRef.current = false;
      speakCueRef.current = false;
      const turnDone = new Promise<void>((resolve) => { turnDoneRef.current = resolve; });
      const reply = await askCalili(userText);
      if (!openRef.current || mutedRef.current) return;
      streamDoneRef.current = true;
      if (queueRef.current.length === 0 && !pumpingRef.current) {
        turnDoneRef.current = null;
        void listenOnce();
        return;
      }
      void pumpQueue();
      await turnDone;
      if (!openRef.current) return;
      void listenOnce();
    } catch {
      if (!openRef.current) return;
      // Un tropiezo de red ya no mata el bucle: se reintenta la escucha
      // hasta 3 veces antes de declarar el error en pantalla.
      errorsRef.current += 1;
      if (errorsRef.current <= 3 && !mutedRef.current) {
        window.setTimeout(() => { if (openRef.current) void listenOnce(); }, 700);
        return;
      }
      playEarcon('error');
      setPhase('error');
    }
  }, [askCalili, pumpQueue]);

  useEffect(() => {
    openRef.current = true;
    // Desbloqueo de audio: este efecto corre justo tras el toque del
    // usuario en el boton del microfono; reproducir un silencio aqui deja
    // el elemento autorizado a sonar el resto de la sesion.
    if (!audioRef.current) {
      const unlock = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=');
      unlock.volume = 0;
      audioRef.current = unlock;
      void unlock.play().catch(() => undefined);
    }
    playEarcon('connect');
    void loadMemoryFacts(useChatStore.getState().dbUserId)
      .then((facts) => { factsRef.current = facts; })
      .catch(() => undefined)
      .finally(() => { if (openRef.current) void listenOnce(); });
    return () => { openRef.current = false; stopTracks(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => { openRef.current = false; stopTracks(); onClose(); };

  const toggleMute = () => {
    if (!mutedRef.current) {
      mutedRef.current = true;
      setMuted(true);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try { recorderRef.current.stop(); } catch { /* ya detenido */ }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      cancelPlayRef.current?.();
      cancelPlayRef.current = null;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
      queueRef.current = [];
      streamDoneRef.current = true;
      const done = turnDoneRef.current;
      turnDoneRef.current = null;
      done?.();
      setLevel(0);
      playEarcon('mute');
    } else {
      mutedRef.current = false;
      setMuted(false);
      playEarcon('unmute');
      void listenOnce();
    }
  };
  const handleOrbTap = () => { if (phase === 'error') void listenOnce(); };

  const orbScale = phase === 'listening' ? 1 + level * 0.22 : phase === 'speaking' ? 1.05 : 1;
  const spinSeconds = phase === 'speaking' ? 10 : phase === 'thinking' ? 6 : 26;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#070b14]/97 backdrop-blur-sm">
      <button
        onClick={handleClose}
        className="absolute right-5 top-5 rounded-full border border-white/15 bg-white/5 p-2.5 text-white/70 hover:bg-white/10 hover:text-white"
        title="Cerrar modo voz"
        aria-label="Cerrar modo voz"
      >
        <X className="h-5 w-5" />
      </button>

      <button onClick={handleOrbTap} className="relative grid place-items-center rounded-full" aria-label="Orbe de voz de Calili">
        <span className={`absolute h-64 w-64 rounded-full bg-sky-500/15 blur-3xl ${phase === 'listening' ? 'animate-ping' : ''}`} style={{ animationDuration: '2.4s' }} />
        <span
          className="relative block h-52 w-52 overflow-hidden rounded-full shadow-[0_0_90px_rgba(56,150,255,0.45)] transition-transform duration-150"
          style={{
            transform: `scale(${orbScale})`,
            background: 'radial-gradient(circle at 50% 42%, #dbeafe 0%, #93c5fd 34%, #3b82f6 68%, #1e3a8a 100%)',
            filter: phase === 'speaking' ? 'brightness(1.15)' : 'brightness(1)',
          }}
        >
          <span
            className="absolute inset-[-25%] block"
            style={{ animation: `calili-orb-spin ${spinSeconds}s linear infinite` }}
          >
            <span className="absolute left-[6%] top-[10%] h-32 w-32 rounded-full bg-sky-300/80 blur-2xl" style={{ animation: 'calili-drift-a 7s ease-in-out infinite alternate' }} />
            <span className="absolute right-[4%] top-[30%] h-36 w-36 rounded-full bg-cyan-200/70 blur-2xl" style={{ animation: 'calili-drift-b 9s ease-in-out infinite alternate' }} />
            <span className="absolute bottom-[2%] left-[26%] h-32 w-32 rounded-full bg-indigo-400/70 blur-2xl" style={{ animation: 'calili-drift-c 8s ease-in-out infinite alternate' }} />
            <span className="absolute left-[38%] top-[2%] h-24 w-24 rounded-full bg-white/80 blur-2xl" style={{ animation: 'calili-drift-b 6s ease-in-out infinite alternate-reverse' }} />
          </span>
          <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_24%,rgba(255,255,255,0.65),rgba(255,255,255,0)_52%)]" />
          <span className="absolute inset-0 rounded-full shadow-[inset_0_-22px_38px_rgba(15,23,42,0.45),inset_0_14px_28px_rgba(255,255,255,0.25)]" />
        </span>
      </button>

      <p className="mt-10 flex items-center gap-2 text-sm uppercase tracking-[0.25em] text-white/50">
        {muted && 'En pausa'}
        {!muted && phase === 'listening' && 'Escuchando'}
        {phase === 'thinking' && 'Pensando'}
        {phase === 'speaking' && 'Calili está hablando'}
        {phase === 'error' && <><MicOff className="h-4 w-4" /> Algo falló</>}
      </p>
      <button
        onClick={toggleMute}
        className={`mt-9 grid h-14 w-14 place-items-center rounded-full border transition ${
          muted
            ? 'border-red-300/40 bg-red-500/80 text-white hover:bg-red-500'
            : 'border-white/15 bg-white/10 text-white hover:bg-white/20'
        }`}
        title={muted ? 'Activar el micrófono' : 'Pausar el micrófono'}
        aria-label={muted ? 'Activar el micrófono' : 'Pausar el micrófono'}
      >
        {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
      </button>
      <p className="mt-6 px-6 text-center text-xs text-white/35">Micrófono: un toque para pausar, otro para seguir. La X cierra el modo voz. La conversación también queda escrita en tu chat.</p>

      <style jsx global>{`
        @keyframes calili-orb-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes calili-drift-a { from { transform: translate(0, 0) scale(1); } to { transform: translate(26px, 18px) scale(1.25); } }
        @keyframes calili-drift-b { from { transform: translate(0, 0) scale(1.15); } to { transform: translate(-24px, 14px) scale(0.9); } }
        @keyframes calili-drift-c { from { transform: translate(0, 0) scale(0.95); } to { transform: translate(18px, -20px) scale(1.2); } }
      `}</style>
    </div>
  );
}
