'use client';

import { Message } from '@/store/chat-store';
import { useSettingsStore } from '@/store/settings-store';
import { User, Bot, Volume2, VolumeX, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { voiceService } from '@/lib/voice-service';

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  const { voiceEnabled, voiceGender } = useSettingsStore();
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
        <div className="text-center max-w-2xl">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Bot className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold mb-2">¡Hola! Soy Calili</h2>
          <p className="text-white/60 mb-6">
            Tu asistente AI personal. Puedo ayudarte con:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="p-4 rounded-lg bg-white/5 border border-white/10">
              <div className="text-2xl mb-2">💬</div>
              <h3 className="font-semibold mb-1">Conversación</h3>
              <p className="text-white/60">Responder preguntas y chatear</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5 border border-white/10">
              <div className="text-2xl mb-2">🎨</div>
              <h3 className="font-semibold mb-1">Imágenes</h3>
              <p className="text-white/60">Generar imágenes con DALL-E</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5 border border-white/10">
              <div className="text-2xl mb-2">🧠</div>
              <h3 className="font-semibold mb-1">Razonamiento</h3>
              <p className="text-white/60">Análisis profundo paso a paso</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-4 space-y-6">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-4 ${
              message.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            {message.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                <Bot className="w-5 h-5" />
              </div>
            )}

            <div
              className={`flex-1 max-w-[80%] ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3'
                  : 'bg-chat-input rounded-2xl rounded-tl-sm px-4 py-3'
              }`}
            >
              {message.role === 'user' ? (
                <p className="whitespace-pre-wrap">{message.content}</p>
              ) : (
                <div className="prose prose-invert max-w-none">
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
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        ) : (
                          <code className={className}>
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

              {message.role === 'assistant' && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/10">
                  {voiceEnabled && (
                    <button
                      onClick={() => handleSpeak(message)}
                      className="p-1.5 rounded hover:bg-white/10 transition-colors"
                      title="Leer en voz alta"
                    >
                      {speakingId === message.id ? (
                        <VolumeX className="w-4 h-4" />
                      ) : (
                        <Volume2 className="w-4 h-4" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => handleCopy(message.content, message.id)}
                    className="p-1.5 rounded hover:bg-white/10 transition-colors"
                    title="Copiar"
                  >
                    {copiedId === message.id ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              )}
            </div>

            {message.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                <User className="w-5 h-5" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
