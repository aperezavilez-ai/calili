import { VoiceGender } from '@/store/settings-store';

class VoiceService {
  private synthesis: SpeechSynthesis | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.synthesis = window.speechSynthesis;
    }
  }

  speak(text: string, gender: VoiceGender = 'female') {
    if (!this.synthesis) return;

    // Cancelar cualquier voz anterior
    this.synthesis.cancel();

    this.utterance = new SpeechSynthesisUtterance(text);

    // Configurar voz según género
    const voices = this.synthesis.getVoices();

    let selectedVoice = voices.find(voice => {
      const lowerName = voice.name.toLowerCase();
      const lowerLang = voice.lang.toLowerCase();

      // Prioridad: Español
      if (!lowerLang.includes('es')) return false;

      if (gender === 'female') {
        return lowerName.includes('female') ||
               lowerName.includes('woman') ||
               lowerName.includes('mónica') ||
               lowerName.includes('lucia') ||
               lowerName.includes('paulina');
      } else {
        return lowerName.includes('male') ||
               lowerName.includes('man') ||
               lowerName.includes('diego') ||
               lowerName.includes('juan');
      }
    });

    // Fallback: cualquier voz en español
    if (!selectedVoice) {
      selectedVoice = voices.find(v => v.lang.toLowerCase().includes('es'));
    }

    if (selectedVoice) {
      this.utterance.voice = selectedVoice;
    }

    this.utterance.rate = 1.0;
    this.utterance.pitch = gender === 'female' ? 1.1 : 0.9;
    this.utterance.volume = 1.0;

    this.synthesis.speak(this.utterance);
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
