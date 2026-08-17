import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type VoiceGender = 'male' | 'female';
export type AIMode = 'chat' | 'reasoning' | 'image';

interface SettingsStore {
  voiceEnabled: boolean;
  voiceGender: VoiceGender;
  aiMode: AIMode;
  selectedModel: string;
  imageSize: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';

  // Actions
  setVoiceEnabled: (enabled: boolean) => void;
  setVoiceGender: (gender: VoiceGender) => void;
  setAIMode: (mode: AIMode) => void;
  setSelectedModel: (model: string) => void;
  setImageSize: (size: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792') => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      voiceEnabled: false,
      voiceGender: 'female',
      aiMode: 'chat',
      selectedModel: 'gpt-4',
      imageSize: '1024x1024',

      setVoiceEnabled: (enabled) => set({ voiceEnabled: enabled }),
      setVoiceGender: (gender) => set({ voiceGender: gender }),
      setAIMode: (mode) => set({ aiMode: mode }),
      setSelectedModel: (model) => set({ selectedModel: model }),
      setImageSize: (size) => set({ imageSize: size }),
    }),
    {
      name: 'calili-settings-storage',
    }
  )
);
