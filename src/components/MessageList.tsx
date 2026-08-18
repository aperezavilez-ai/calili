'use client';

import { Message } from '@/store/chat-store';
import { useSettingsStore } from '@/store/settings-store';
import { User, Bot, Volume2, VolumeX, Copy, Check, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { voiceService } from '@/lib/voice-service';

interface MessageListProps {
  messages: Message[];
  onDownload: (content: string, format: 'md' | 'pdf' | 'docx') => void;
}

export function MessageList({ messages, onDownload }: MessageListProps) {
  const { voiceEnabled, voiceGender } = useSettingsStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Mantiene visible el mensaje actual también durante el streaming.
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  const handleSpeak = (message: Message) => {
    if (speakingId === message.id) {
      voiceService.stop();
      setSpeakingId(null);
    } else {
      voiceService.speak(message.content, voiceGender);
      setSpeakingId(message.id);
    }
  };

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-3xl">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 flex items-center justify-center shadow-2xl">
            <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <h1 className="text-4xl font-semibold mb-3 bg-gradient-to-r from-purple-400 via-pink-400 to-orange-400 bg-clip-text text-transparent">
            Calili
          </h1>
          <p className="text-lg text-white/70 mb-8">
            ¿En qué puedo ayudarte hoy?
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
            <button className="group p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-left">
              <div className="text-2xl mb-2">💬</div>
              <h3 className="font-semibold mb-1 text-white group-hover:text-purple-400 transition-colors">Conversación natural</h3>
              <p className="text-sm text-white/60">Responde preguntas, escribe código, ayuda con tareas</p>
            </button>

            <button className="group p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-left">
              <div className="text-2xl mb-2">🎨</div>
              <h3 className="font-semibold mb-1 text-white group-hover:text-pink-400 transition-colors">Generación de imágenes</h3>
              <p className="text-sm text-white/60">Crea imágenes únicas con DALL-E 3</p>
            </button>

            <button className="group p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-left">
              <div className="text-2xl mb-2">🧠</div>
              <h3 className="font-semibold mb-1 text-white group-hover:text-orange-400 transition-colors">Razonamiento profundo</h3>
              <p className="text-sm text-white/60">Análisis detallado paso a paso</p>
            </button>

            <button className="group p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-left">
              <div className="text-2xl mb-2">🔊</div>
              <h3 className="font-semibold mb-1 text-white group-hover:text-blue-400 transition-colors">Síntesis de voz</h3>
              <p className="text-sm text-white/60">Escucha las respuestas en español</p>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8">
        {messages.map((message, index) => (
          <div
            key={message.id}
            className={`flex gap-6 ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {/* Avatar */}
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
              message.role === 'user'
                ? 'bg-gradient-to-br from-blue-500 to-cyan-500'
                : 'bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500'
            } shadow-lg`}>
              {message.role === 'user' ? (
                <User className="w-5 h-5 text-white" />
              ) : (
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 space-y-2 max-w-full overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">
                  {message.role === 'user' ? 'Tú' : 'Calili'}
                </span>
                {message.role === 'assistant' && index === messages.length - 1 && (
                  <span className="text-xs text-white/40">● En línea</span>
                )}
              </div>

              <div className={`${
                message.role === 'user'
                  ? 'text-white/90'
                  : 'text-white/95'
              }`}>
                {message.id === 'loading' ? (
                  <div className="flex items-center gap-1 py-1" aria-label="Calili está pensando">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-white/80 [animation-delay:-0.3s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-white/80 [animation-delay:-0.15s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-white/80" />
                  </div>
                ) : message.role === 'user' ? (
                  <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                ) : (
                  <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-black/20 prose-pre:border prose-pre:border-white/10">
                    <ReactMarkdown
                      components={{
                        code(props) {
                          const { className, children } = props;
                          const match = /language-(\w+)/.exec(className || '');
                          return match ? (
                            <SyntaxHighlighter
                              style={vscDarkPlus as any}
                              language={match[1]}
                              PreTag="div"
                              customStyle={{
                                background: 'rgba(0,0,0,0.3)',
                                borderRadius: '8px',
                                padding: '16px',
                                fontSize: '14px'
                              }}
                            >
                              {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                          ) : (
                            <code className="bg-white/10 px-1.5 py-0.5 rounded text-sm">
                              {children}
                            </code>
                          );
                        },
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>

              {/* Actions */}
              {message.role === 'assistant' && (
                <div className="flex items-center gap-1 pt-2">
                  {voiceEnabled && (
                    <button
                      onClick={() => handleSpeak(message)}
                      className="p-2 rounded-lg hover:bg-white/5 transition-colors group"
                      title="Leer en voz alta"
                    >
                      {speakingId === message.id ? (
                        <VolumeX className="w-4 h-4 text-white/60" />
                      ) : (
                        <Volume2 className="w-4 h-4 text-white/40 group-hover:text-white/60" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => handleCopy(message.content, message.id)}
                    className="p-2 rounded-lg hover:bg-white/5 transition-colors group"
                    title="Copiar"
                  >
                    {copiedId === message.id ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4 text-white/40 group-hover:text-white/60" />
                    )}
                  </button>
                  {message.id !== 'loading' && message.id !== 'streaming' && (
                    <>
                      {(['pdf', 'docx', 'md'] as const).map((format) => (
                        <button key={format} onClick={() => onDownload(message.content, format)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-white/40 transition-colors hover:bg-white/5 hover:text-white/70" title={`Descargar ${format === 'docx' ? 'Word' : format.toUpperCase()}`}>
                          <Download className="h-3.5 w-3.5" />
                          {format === 'docx' ? 'Word' : format.toUpperCase()}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
