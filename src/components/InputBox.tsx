'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Image as ImageIcon, Brain, MessageCircle } from 'lucide-react';
import { useSettingsStore } from '@/store/settings-store';
import { useChatStore } from '@/store/chat-store';

interface InputBoxProps {
  onSendMessage: (message: string) => void;
  isLoading: boolean;
}

export function InputBox({ onSendMessage, isLoading }: InputBoxProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { aiMode, setAIMode } = useSettingsStore();

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  const handleSubmit = () => {
    if (!input.trim() || isLoading) return;

    onSendMessage(input.trim());
    setInput('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-white/10 bg-chat-bg p-4">
      <div className="max-w-3xl mx-auto">
        {/* Mode Selector */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setAIMode('chat')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              aiMode === 'chat'
                ? 'bg-blue-600 text-white'
                : 'bg-white/10 hover:bg-white/20'
            }`}
          >
            <MessageCircle className="w-4 h-4" />
            Chat
          </button>
          <button
            onClick={() => setAIMode('reasoning')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              aiMode === 'reasoning'
                ? 'bg-purple-600 text-white'
                : 'bg-white/10 hover:bg-white/20'
            }`}
          >
            <Brain className="w-4 h-4" />
            Razonamiento
          </button>
          <button
            onClick={() => setAIMode('image')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              aiMode === 'image'
                ? 'bg-pink-600 text-white'
                : 'bg-white/10 hover:bg-white/20'
            }`}
          >
            <ImageIcon className="w-4 h-4" />
            Imagen
          </button>
        </div>

        {/* Input Box */}
        <div className="flex items-end gap-2 bg-chat-input rounded-2xl p-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              aiMode === 'image'
                ? 'Describe la imagen que quieres generar...'
                : aiMode === 'reasoning'
                ? 'Escribe un problema que requiera razonamiento...'
                : 'Escribe un mensaje...'
            }
            className="flex-1 bg-transparent outline-none resize-none max-h-32 min-h-[24px]"
            rows={1}
            disabled={isLoading}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isLoading}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>

        <p className="text-xs text-white/40 text-center mt-2">
          {aiMode === 'image'
            ? 'Generaré una imagen basada en tu descripción'
            : aiMode === 'reasoning'
            ? 'Activaré modo de razonamiento profundo'
            : 'Calili puede cometer errores. Verifica la información importante.'}
        </p>
      </div>
    </div>
  );
}
