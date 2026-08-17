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
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
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
        {/* Input Box estilo ChatGPT */}
        <div className="relative flex items-end gap-2 bg-[#40414f] rounded-3xl p-3 shadow-2xl border border-white/10">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Envía un mensaje a Calili..."
            className="flex-1 bg-transparent outline-none resize-none max-h-[200px] min-h-[24px] text-white placeholder:text-white/40 leading-relaxed"
            rows={1}
            disabled={isLoading}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isLoading}
            className={`p-2 rounded-xl transition-all flex-shrink-0 ${
              input.trim() && !isLoading
                ? 'bg-white text-black hover:bg-white/90'
                : 'bg-white/10 text-white/40 cursor-not-allowed'
            }`}
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>

        <p className="text-xs text-white/30 text-center mt-3">
          Calili puede cometer errores. Verifica la información importante.
        </p>
      </div>
    </div>
  );
}
