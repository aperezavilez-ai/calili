'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Mic, Square, Paperclip, X } from 'lucide-react';

interface InputBoxProps {
  onSendMessage: (message: string, files: File[]) => void;
  onStopMessage: () => void;
  isLoading: boolean;
  onVoiceMode?: () => void;
  focusKey?: string;
}

export function InputBox({ onSendMessage, onStopMessage, isLoading, onVoiceMode, focusKey }: InputBoxProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // El cursor vive en el recuadro: al abrir el chat, al cambiar de
  // conversación, al cerrar el modo voz y al terminar cada respuesta,
  // el foco regresa solo y se puede escribir sin dar clic. Sin
  // compuerta de puntero (v3.4.1): la compuerta '(pointer: fine)'
  // dejaba sin cursor a los equipos donde el navegador no lo reporta
  // así (portátiles táctiles, PWA en tableta) — el juicio de Luis fue
  // en PC y el cursor no aparecía. El atributo autoFocus del textarea
  // es el respaldo del primer montaje.
  useEffect(() => {
    if (!isLoading) textareaRef.current?.focus();
  }, [isLoading, focusKey]);





  const handleSubmit = () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

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
          <input ref={fileInputRef} type="file" multiple accept=".txt,.md,.csv,.json,.xml,.html,.pdf,.docx,.xlsx,image/*" onChange={handleFiles} className="hidden" />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isLoading} className="flex-shrink-0 rounded-xl p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white" title="Adjuntar archivos">
            <Paperclip className="h-5 w-5" />
          </button>
          <textarea
            ref={textareaRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Envía un mensaje a Calili..."
            className="flex-1 bg-transparent outline-none resize-none max-h-[200px] min-h-[24px] text-white placeholder:text-white/40 leading-relaxed"
            rows={1}
          />

          {/* Botón de voz */}
          <button
            type="button"
            onClick={() => onVoiceMode?.()}
            className="p-2 rounded-xl transition-all flex-shrink-0 hover:bg-white/10 text-white/60 hover:text-white"
            title="Hablar con Calili (modo voz)"
          >
            <Mic className="w-5 h-5" />
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
