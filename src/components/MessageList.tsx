'use client';

import { Message } from '@/store/chat-store';
import { User, Copy, Check, RefreshCw, Pencil, Volume2, Square, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fixMarkdownTables } from '@/lib/markdown-fix';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface MessageListProps {
  messages: Message[];
  isLoading?: boolean;
  onRegenerate?: () => void;
  onEditMessage?: (messageId: string, newText: string) => void;
  onSuggestion?: (text: string) => void;
}

const SUGGESTIONS: Array<{ title: string; hint: string; prompt: string }> = [
  {
    title: 'Crear un Excel',
    hint: 'Una tabla lista para descargar',
    prompt: 'Crea una hoja de Excel con una tabla de precios de ejemplo para un negocio de servicios: columnas de servicio, descripción y precio.',
  },
  {
    title: 'Buscar en internet',
    hint: 'Información reciente con fuentes',
    prompt: 'Busca en internet las novedades más recientes de inteligencia artificial y resúmelas en puntos breves.',
  },
  {
    title: 'Crear una imagen',
    hint: 'Describe lo que imaginas',
    prompt: 'Crea una imagen de un león majestuoso en estilo blackwork, fondo oscuro y alto contraste.',
  },
  {
    title: 'Redactar un texto',
    hint: 'Un correo profesional en segundos',
    prompt: 'Redacta un correo profesional y amable para confirmar una cita con un cliente e indicarle cómo prepararse.',
  },
];

function cleanForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' (bloque de código) ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch { /* portapapeles no disponible */ }
      }}
      className="rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
      title="Copiar"
      aria-label="Copiar"
    >
      {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

const actionBtn = 'rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-40';

export function MessageList({ messages, isLoading, onRegenerate, onEditMessage, onSuggestion }: MessageListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [loadingSpeakId, setLoadingSpeakId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const speakText = async (id: string, raw: string) => {
    if (speakingId === id) {
      audioRef.current?.pause();
      setSpeakingId(null);
      return;
    }
    audioRef.current?.pause();
    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }
    setLoadingSpeakId(id);
    try {
      const res = await apiFetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanForSpeech(raw) }),
      });
      if (!res.ok) throw new Error('speak');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setSpeakingId(null); URL.revokeObjectURL(url); if (audioUrlRef.current === url) audioUrlRef.current = null; };
      setSpeakingId(id);
      await audio.play();
    } catch {
      setSpeakingId(null);
    } finally {
      setLoadingSpeakId(null);
    }
  };
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    // Solo se persigue el fondo si el usuario YA esta abajo: si subio a
    // leer el historial durante el streaming, no se le arrastra de vuelta.
    if (!nearBottomRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

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
          {onSuggestion && (
            <div className="grid gap-2 text-left sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.title}
                  onClick={() => onSuggestion(s.prompt)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition hover:bg-white/10"
                >
                  <span className="block text-sm font-medium text-white/90">{s.title}</span>
                  <span className="mt-0.5 block text-xs text-white/50">{s.hint}</span>
                </button>
              ))}
            </div>
          )}

        </div>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto" onScroll={(e) => { const el = e.currentTarget; nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140; }}>
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
                  editingId === message.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={3}
                        autoFocus
                        className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-white/95 outline-none focus:border-sky-400/60"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setEditingId(null); onEditMessage?.(message.id, draft); }}
                          className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400"
                        >
                          Enviar
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:bg-white/10"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                  )
                ) : (
                  <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-black/20 prose-pre:border prose-pre:border-white/10">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        table(props) {
                          return (
                            <div className="overflow-x-auto my-3">
                              <table className="w-full border-collapse text-sm">
                                {props.children}
                              </table>
                            </div>
                          );
                        },
                        th(props) {
                          return (
                            <th className="border border-white/20 bg-white/10 px-3 py-2 text-left font-semibold">
                              {props.children}
                            </th>
                          );
                        },
                        td(props) {
                          return (
                            <td className="border border-white/20 px-3 py-2 align-top">
                              {props.children}
                            </td>
                          );
                        },
                        code(props) {
                          const { className, children } = props;
                          const match = /language-(\w+)/.exec(className || '');
                          const codeText = String(children).replace(/\n$/, '');
                          return match ? (
                            <div className="relative">
                              <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
                                <span className="text-[11px] uppercase tracking-wide text-white/40">{match[1]}</span>
                                <CopyButton text={codeText} />
                              </div>
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
                                {codeText}
                              </SyntaxHighlighter>
                            </div>
                          ) : (
                            <code className="bg-white/10 px-1.5 py-0.5 rounded text-sm">
                              {children}
                            </code>
                          );
                        },
                      }}
                    >
                      {fixMarkdownTables(message.content)}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
              {message.id !== 'loading' && (
                <div className="flex items-center gap-1 pt-1 opacity-70 transition-opacity hover:opacity-100">
                  {message.role === 'assistant' ? (
                    <>
                      <CopyButton text={message.content} />
                      <button onClick={() => void speakText(message.id, message.content)} className={actionBtn} title="Escuchar" aria-label="Escuchar">
                        {loadingSpeakId === message.id ? <Loader2 className="h-4 w-4 animate-spin" /> : speakingId === message.id ? <Square className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                      </button>
                      {index === messages.length - 1 && onRegenerate && (
                        <button onClick={onRegenerate} disabled={isLoading} className={actionBtn} title="Regenerar respuesta" aria-label="Regenerar respuesta">
                          <RefreshCw className="h-4 w-4" />
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <CopyButton text={message.content} />
                      {onEditMessage && (
                        <button onClick={() => { setEditingId(message.id); setDraft(message.content); }} className={actionBtn} title="Editar mensaje" aria-label="Editar mensaje">
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
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
