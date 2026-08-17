'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Mic, MicOff } from 'lucide-react';

interface InputBoxProps {
  onSendMessage: (message: string) => void;
  isLoading: boolean;
}

export function InputBox({ onSendMessage, isLoading }: InputBoxProps) {
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  useEffect(() => {
    // Inicializar reconocimiento de voz
    if (typeof window !== 'undefined' && 'webkitSpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'es-ES';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(prev => prev + transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = () => {
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

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

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  return (
    <div className="border-t border-white/10 bg-chat-bg">
      <div className="max-w-3xl mx-auto px-4 py-4">
        {/* Input Box estilo ChatGPT */}
        <div className="relative flex items-end gap-2 bg-[#40414f] rounded-3xl py-3 px-4 shadow-2xl border border-white/10">
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

          {/* Botón de voz */}
          <button
            onClick={toggleListening}
            className={`p-2 rounded-xl transition-all flex-shrink-0 ${
              isListening
                ? 'bg-red-500 text-white animate-pulse'
                : 'hover:bg-white/10 text-white/60'
            }`}
            title="Hablar con Calili"
          >
            {isListening ? (
              <MicOff className="w-5 h-5" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>

          {/* Botón enviar */}
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
