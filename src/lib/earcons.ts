// Efectos auditivos suaves de la orbe (como los de ChatGPT): tonos cortos
// generados con WebAudio, sin archivos. Volumen bajo por diseño.

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

function tone(
  ac: AudioContext,
  startAt: number,
  from: number,
  to: number,
  duration: number,
  peak = 0.055,
  type: OscillatorType = 'sine',
) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, startAt);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), startAt + duration);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
}

export type EarconKind = 'connect' | 'listen' | 'speak' | 'mute' | 'unmute' | 'error';

export function playEarcon(kind: EarconKind) {
  const ac = audioContext();
  if (!ac) return;
  const now = ac.currentTime + 0.01;
  switch (kind) {
    case 'connect': // conexion: arpegio calido ascendente (como ChatGPT al entrar)
      tone(ac, now, 392, 392, 0.12, 0.04);
      tone(ac, now + 0.09, 587, 587, 0.12, 0.04);
      tone(ac, now + 0.18, 784, 784, 0.22, 0.045);
      break;
    case 'listen': // pop ascendente suave: "te escucho"
      tone(ac, now, 540, 880, 0.13);
      break;
    case 'speak': // chime cálido de dos notas: "voy a hablar"
      tone(ac, now, 660, 660, 0.1, 0.045);
      tone(ac, now + 0.07, 990, 990, 0.16, 0.05);
      break;
    case 'mute': // descenso corto: pausa
      tone(ac, now, 420, 230, 0.11, 0.045);
      break;
    case 'unmute': // ascenso corto: de vuelta
      tone(ac, now, 300, 560, 0.11, 0.045);
      break;
    case 'error': // golpe grave y suave
      tone(ac, now, 190, 130, 0.18, 0.05, 'triangle');
      break;
  }
}
