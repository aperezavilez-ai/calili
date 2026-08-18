'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Mic, MicOff, Square, Paperclip, X } from 'lucide-react';

interface InputBoxProps {
  onSendMessage: (message: string, files: File[]) => void;
  onStopMessage: () => void;
  isLoading: boolean;
}

export function InputBox({ onSendMessage, onStopMessage, isLoading }: InputBoxProps) {
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
        if (window.speechSynthesis?.speaking) {
          recognitionRef.current?.abort();
          setIsListening(false);
          return;
        }
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

  useEffect(() => {
    if (!isLoading) return;
    recognitionRef.current?.abort();
    setIsListening(false);
  }, [isLoading]);

  const handleSubmit = () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

    recognitionRef.current?.abort();
    setIsListening(false);
    onSendMessage(input.trim() || 'Analiza los archivos adjuntos.', attachments);
    setInput('');
    setAttachments([]);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    setAttachments((current) => [...current, ...selected].slice(0, 4));
    event.target.value = '';
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedImages = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item, index) => {
        const image = item.getAsFile();
        if (!image) return null;
        const extension = image.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
        return new File([image], `captura-${Date.now()}-${index + 1}.${extension}`, {
          type: image.type,
          lastModified: Date.now(),
        });
      })
      .filter((file): file is File => Boolean(file));

    if (pastedImages.length === 0) return;
    event.preventDefault();
    setAttachments((current) => [...current, ...pastedImages].slice(0, 4));
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
      if (window.speechSynthesis?.speaking) {
        alert('Espera a que Calili termine de hablar antes de activar el micrófono.');
        return;
      }
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  return (
    <div className="border-t border-white/10 bg-chat-bg">
      <div className="max-w-3xl mx-auto px-4 py-4">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((file, index) => (
              <div key={`${file.name}-${index}`} className="flex max-w-full items-center gap-1 rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-xs text-white/80">
                <span className="max-w-[180px] truncate">{file.name}</span>
                <button type="button" onClick={() => setAttachments((current) => current.filter((_, fileIndex) => fileIndex !== index))} title="Quitar archivo" className="text-white/50 hover:text-white">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input Box estilo ChatGPT */}
        <div className="relative flex items-end gap-2 bg-[#40414f] rounded-3xl py-3 px-4 shadow-2xl border border-white/10">
          <input ref={fileInputRef} type="file" multiple accept=".txt,.md,.csv,.json,.xml,.html,.pdf,.docx,image/*" onChange={handleFiles} className="hidden" />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isLoading} className="flex-shrink-0 rounded-xl p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white" title="Adjuntar archivos">
            <Paperclip className="h-5 w-5" />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
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
            onClick={isLoading ? onStopMessage : handleSubmit}
            disabled={!isLoading && !input.trim() && attachments.length === 0}
            className={`p-2 rounded-xl transition-all flex-shrink-0 ${
              isLoading
                ? 'bg-red-500 text-white hover:bg-red-400'
                : input.trim()
                ? 'bg-white text-black hover:bg-white/90'
                : 'bg-white/10 text-white/40 cursor-not-allowed'
            }`}
            title={isLoading ? 'Detener respuesta' : 'Enviar mensaje'}
          >
            {isLoading ? (
              <Square className="w-4 h-4 fill-current" />
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
