import { VoiceGender } from '@/store/settings-store';

class VoiceService {
  private synthesis: SpeechSynthesis | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.synthesis = window.speechSynthesis;
    }
  }

  private selectVoice(voices: SpeechSynthesisVoice[], gender: VoiceGender): SpeechSynthesisVoice | undefined {
    const spanish = voices.filter((voice) => voice.lang.toLowerCase().startsWith('es'));
    const femaleNames = ['dalia', 'sabina', 'elvira', 'lucia', 'lucía', 'monica', 'mónica', 'paulina', 'helena', 'sofia', 'sofía', 'maria', 'maría', 'female', 'woman'];
    const maleNames = ['jorge', 'raul', 'raúl', 'alvaro', 'álvaro', 'diego', 'juan', 'pablo', 'male', 'man'];
    const genderNames = gender === 'female' ? femaleNames : maleNames;

    const scored = spanish.map((voice) => {
      const name = voice.name.toLowerCase();
      let score = 0;
      if (genderNames.some((candidate) => name.includes(candidate))) score += 100;
      if (/natural|neural|online|google/.test(name)) score += 30;
      if (voice.lang.toLowerCase() === 'es-mx') score += 20;
      if (voice.localService === false) score += 10;
      return { voice, score };
    }).sort((a, b) => b.score - a.score);

    const genderMatch = scored.find((entry) => entry.score >= 100)?.voice;
    if (genderMatch) return genderMatch;

    const natural = scored.filter((entry) => entry.score >= 30).map((entry) => entry.voice);
    return gender === 'male' ? natural[1] ?? natural[0] ?? spanish[1] ?? spanish[0] : natural[0] ?? spanish[0];
  }

  private speakWithVoices(text: string, gender: VoiceGender, voices: SpeechSynthesisVoice[]) {
    if (!this.synthesis) return;

    const cleanText = text
      .replace(/!\[.*?\]\(.*?\)/g, 'imagen generada')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/[*_`]/g, '')
      .slice(0, 1200);

    this.utterance = new SpeechSynthesisUtterance(cleanText);
    const selectedVoice = this.selectVoice(voices, gender);
    if (selectedVoice) this.utterance.voice = selectedVoice;
    this.utterance.lang = selectedVoice?.lang ?? 'es-MX';
    this.utterance.rate = 0.96;
    this.utterance.pitch = gender === 'female' ? 1.03 : 0.97;
    this.utterance.volume = 1;
    this.synthesis.speak(this.utterance);
  }

  speak(text: string, gender: VoiceGender = 'female') {
    if (!this.synthesis) return;

    // Cancelar cualquier voz anterior
    this.synthesis.cancel();

    const voices = this.synthesis.getVoices();
    if (voices.length > 0) {
      this.speakWithVoices(text, gender, voices);
      return;
    }

    const loadVoices = () => {
      this.synthesis?.removeEventListener('voiceschanged', loadVoices);
      this.speakWithVoices(text, gender, this.synthesis?.getVoices() ?? []);
    };
    this.synthesis.addEventListener('voiceschanged', loadVoices);
  }

  stop() {
    if (this.synthesis) {
      this.synthesis.cancel();
    }
  }

  pause() {
    if (this.synthesis) {
      this.synthesis.pause();
    }
  }

  resume() {
    if (this.synthesis) {
      this.synthesis.resume();
    }
  }

  isSpeaking(): boolean {
    return this.synthesis?.speaking || false;
  }
}

export const voiceService = new VoiceService();
