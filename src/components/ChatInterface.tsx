'use client';

import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/store/chat-store';
import { useSettingsStore } from '@/store/settings-store';
import { apiFetch } from '@/lib/api-client';
import { Sidebar } from '@/components/Sidebar';
import { MessageList } from '@/components/MessageList';
import { InputBox } from '@/components/InputBox';
import { voiceService } from '@/lib/voice-service';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { fetchConversations, uploadLocalConversation } from '@/lib/chat-db';
import { AuthScreen } from '@/components/AuthScreen';
import VoiceMode from '@/components/VoiceMode';
import { normalizeCaliliResponse } from '@/lib/response-policy';
import { InstallBanner } from '@/components/InstallBanner';
import { loadMemoryFacts, saveMemoryFact, removeMemoryFact } from '@/lib/memory-facts';

export default function ChatInterface() {
  const {
    conversations,
    currentConversationId,
    createConversation,
    addMessage,
    isLoading,
    setLoading,
    isSidebarOpen,
    toggleSidebar,
    setDbUser,
    replaceConversations,
    clearAllConversations,
    removeMessage,
    truncateConversation,
    setConversationSummary,
  } = useChatStore();

  const [authStatus, setAuthStatus] = useState<'checking' | 'local' | 'signedOut' | 'signedIn'>('checking');
  const [userEmail, setUserEmail] = useState('');

  const { voiceEnabled, voiceGender } = useSettingsStore();
  const [streamingContent, setStreamingContent] = useState('');
  // Los archivos generados viven POR conversacion: antes eran un estado
  // global que se borraba al cambiar de chat y la tarjeta de descarga se
  // perdia para siempre.
  const [filesByConversation, setFilesByConversation] = useState<Record<string, Array<{ id: string; name: string; mime: string; base64: string; messageId?: string }>>>({});
  const generatedFiles = filesByConversation[currentConversationId ?? ''] ?? [];
  // Archivos que llegan DURANTE un turno (el evento {file} precede al
  // texto de cierre): se guardan como pendientes y al confirmarse el
  // mensaje del asistente se le ASIGNAN, para que su tarjeta viva dentro
  // de la conversacion, bajo ese mensaje, y suba con el historial en vez
  // de quedarse pegada sobre el recuadro de escritura.
  const pendingTurnFilesRef = useRef<Record<string, string[]>>({});
  const addGeneratedFile = (convId: string, file: { name: string; mime: string; base64: string }) => {
    const record = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...file };
    setFilesByConversation((prev) => ({
      ...prev,
      [convId]: [...(prev[convId] ?? []), record],
    }));
    pendingTurnFilesRef.current[convId] = [...(pendingTurnFilesRef.current[convId] ?? []), record.id];
    return record;
  };
  const flushPendingFiles = (convId: string) => {
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
    const msgs = conv?.messages ?? [];
    let lastAssistantId: string | undefined;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') { lastAssistantId = msgs[i].id; break; }
    }
    if (!lastAssistantId) return;
    const existingIds = new Set(msgs.map((m) => m.id));
    const pending = new Set(pendingTurnFilesRef.current[convId] ?? []);
    pendingTurnFilesRef.current[convId] = [];
    if (pending.size === 0) {
      // Sin pendientes: solo rescata huerfanos si su mensaje ya no existe.
      setFilesByConversation((prev) => {
        const list = prev[convId] ?? [];
        if (!list.some((f) => f.messageId && !existingIds.has(f.messageId))) return prev;
        return {
          ...prev,
          [convId]: list.map((f) => (f.messageId && !existingIds.has(f.messageId) ? { ...f, messageId: lastAssistantId } : f)),
        };
      });
      return;
    }
    setFilesByConversation((prev) => ({
      ...prev,
      [convId]: (prev[convId] ?? []).map((f) =>
        pending.has(f.id) || (f.messageId && !existingIds.has(f.messageId))
          ? { ...f, messageId: lastAssistantId }
          : f,
      ),
    }));
  };
  const [streamingConvId, setStreamingConvId] = useState<string | null>(null);
  const partialContentRef = useRef('');
  const handledUsersRef = useRef<Set<string>>(new Set());
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
  const [memoryFacts, setMemoryFacts] = useState<string[]>([]);

  // Memoria de largo plazo: se carga al entrar (local + Supabase) y viaja
  // en cada mensaje para que Calili recuerde entre conversaciones.
  useEffect(() => {
    if (authStatus === 'local' || authStatus === 'signedIn') {
      void loadMemoryFacts(useChatStore.getState().dbUserId).then(setMemoryFacts).catch(() => undefined);
    }
  }, [authStatus]);
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);
  const touchStartX = useRef<number | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (!isSidebarOpen && startX >= 28 && startX < 140 && dx > 64 && window.innerWidth < 768) toggleSidebar();
  };

  const currentConversation = conversations.find((c) => c.id === currentConversationId);

  // Centinela de historial (movil): el gesto "atras" del sistema primero
  // cierra el panel si esta abierto, y si no, se consume sin salir de la app.
  // Sin esto, deslizar desde el borde invoca el "atras" del sistema y la
  // PWA se cierra de golpe.
  useEffect(() => {
    if (window.innerWidth >= 768) return;
    window.history.pushState({ caliliGuard: true }, '');
    const onPopState = () => {
      if (useChatStore.getState().isSidebarOpen) {
        useChatStore.getState().toggleSidebar();
        window.history.pushState({ caliliGuard: true }, '');
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Solo al montar: en movil el panel arranca cerrado. (El efecto anterior
  // dependia de isSidebarOpen y cerraba el panel 500 ms despues de abrirlo.)
  useEffect(() => {
    if (window.innerWidth < 768 && useChatStore.getState().isSidebarOpen) {
      useChatStore.getState().toggleSidebar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setAuthStatus('local');
      return;
    }

    let cancelled = false;

    const handleUser = async (user: { id: string; email?: string } | null) => {
      if (cancelled) return;
      if (!user) {
        setDbUser(null);
        setUserEmail('');
        setAuthStatus('signedOut');
        return;
      }
      setDbUser(user.id);
      setUserEmail(user.email ?? '');
      setAuthStatus('signedIn');
      // getSession y onAuthStateChange disparan AMBOS al cargar: sin esta
      // guarda, la carga/subida del historial corria dos veces en paralelo.
      if (handledUsersRef.current.has(user.id)) return;
      handledUsersRef.current.add(user.id);
      try {
        const remote = await fetchConversations(user.id);
        if (cancelled) return;
        // Se suben las conversaciones que solo existen en local (su
        // sincronizacion pudo fallar antes) en vez de descartarlas al
        // reemplazar con lo remoto.
        const remoteIds = new Set(remote.map((c) => c.id));
        const localOnly = useChatStore.getState().conversations.filter((c) => !remoteIds.has(c.id));
        for (const conversation of localOnly) {
          await uploadLocalConversation(user.id, conversation).catch(() => undefined);
        }
        if (localOnly.length > 0) {
          const merged = await fetchConversations(user.id);
          if (!cancelled) replaceConversations(merged);
        } else if (remote.length > 0) {
          replaceConversations(remote);
        }
      } catch (error) {
        console.error('Calili: no se pudo cargar el historial de Supabase', error);
      }
    };

    supabase.auth.getSession().then(({ data }) => handleUser(data.session?.user ?? null));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      handleUser(session?.user ?? null);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    await supabase?.auth.signOut();
    setDbUser(null);
    clearAllConversations();
    setUserEmail('');
    setAuthStatus('signedOut');
  };

  const speakResponse = (text: string) => {
    if (voiceEnabled) voiceService.speak(text, voiceGender);
  };

  // Una pasada completa contra /api/chat: transmite, aplica eventos de
  // archivo y memoria, y devuelve el texto acumulado. La usan el envio
  // normal, la regeneracion y la edicion de mensajes.
  const streamReply = async (
    msgs: Array<{ role: string; content: string }>,
    imageDataUrls: string[],
    convId?: string,
  ): Promise<string> => {
    const chatController = new AbortController();
    activeRequestControllerRef.current = chatController;
    const timeout = window.setTimeout(() => chatController.abort(), 300000);
    try {
      const response = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: msgs,
          model: useSettingsStore.getState().selectedModel,
          images: imageDataUrls,
          memory: memoryFacts,
          summary: convId ? useChatStore.getState().conversations.find((c) => c.id === convId)?.summary ?? '' : '',
          summaryUpTo: convId ? useChatStore.getState().conversations.find((c) => c.id === convId)?.summaryUpTo ?? 0 : 0,
        }),
        signal: chatController.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Error ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No se pudo leer la respuesta');

      const decoder = new TextDecoder();
      let accumulatedContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) throw new Error(parsed.error);
              if (parsed.file && convId) {
                addGeneratedFile(convId, { name: parsed.file.name, mime: parsed.file.mime, base64: parsed.file.base64 });
              }
              if (parsed.summary && convId) {
                setConversationSummary(convId, String(parsed.summary.text || ''), Number(parsed.summary.upTo) || 0);
              }
              if (parsed.memory) {
                const userId = useChatStore.getState().dbUserId;
                if (parsed.memory.action === 'add') {
                  void saveMemoryFact(userId, String(parsed.memory.fact || '')).then(setMemoryFacts).catch(() => undefined);
                } else {
                  void removeMemoryFact(userId, String(parsed.memory.fact || '')).then(setMemoryFacts).catch(() => undefined);
                }
              }
              if (parsed.content) {
                accumulatedContent += parsed.content;
                partialContentRef.current = accumulatedContent;
                setStreamingContent(normalizeCaliliResponse(accumulatedContent));
              }
            } catch (parseError) {
              // Una linea SSE corrupta ya no aborta la respuesta entera:
              // solo los errores que manda el servidor se propagan.
              if (parseError instanceof SyntaxError) continue;
              throw parseError;
            }
          }
        }
      }

      return accumulatedContent;
    } finally {
      window.clearTimeout(timeout);
      activeRequestControllerRef.current = null;
    }
  };

  const handleSendMessage = async (content: string, files: File[] = []) => {
    voiceService.stop();
    let convId = currentConversationId;

    if (!convId) {
      convId = createConversation();
    }

    const fileLabel = files.length ? `\n\nAdjuntos: ${files.map((file) => file.name).join(', ')}` : '';
    addMessage(convId, { role: 'user', content: `${content}${fileLabel}` });

    setLoading(true);
    setStreamingContent('');
    setStreamingConvId(convId);
    partialContentRef.current = '';
    cancelRequestedRef.current = false;

    const wantsVoice = /\b(habla|hablando|voz|en voz alta|lee|leer)\b/i.test(content);

    try {
      let modelContent = content;
      const imageFiles = files.filter((file) => file.type.startsWith('image/'));
      const docFiles = files.filter((file) => !file.type.startsWith('image/'));
      const imageDataUrls: string[] = await Promise.all(
        imageFiles.slice(0, 5).map(
          (file) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error('No se pudo leer la imagen adjunta.'));
              reader.readAsDataURL(file);
            }),
        ),
      );
      if (docFiles.length > 0) {
        const formData = new FormData();
        docFiles.forEach((file) => formData.append('files', file));
        const fileResponse = await apiFetch('/api/files', { method: 'POST', body: formData });
        if (!fileResponse.ok) {
          const errorData = await fileResponse.json().catch(() => ({}));
          throw new Error(errorData.error || 'No se pudieron analizar los archivos.');
        }
        const fileData = await fileResponse.json();
        const extracted = (fileData.attachments ?? []) as Array<{ name: string; text?: string; analyzableImage?: boolean }>;
        const extractedText = extracted.filter((file) => file.text).map((file) => `--- ${file.name} ---\n${file.text}`).join('\n\n');
        if (extractedText) modelContent += `\n\nContenido extraído de los archivos:\n${extractedText}`;
      }

      if (cancelRequestedRef.current) return;
      {
        // Mensajes frescos del store (ya incluyen el que se acaba de
        // agregar); el ultimo del usuario lleva el contenido enriquecido
        // con el texto extraido de los archivos.
        const fresh = useChatStore.getState().conversations.find((c) => c.id === convId);
        const msgs = (fresh?.messages || []).map((m) => ({ role: m.role, content: m.content }));
        let lastUserIdx = -1;
        msgs.forEach((m, i) => { if (m.role === 'user') lastUserIdx = i; });
        if (lastUserIdx >= 0) msgs[lastUserIdx] = { role: 'user', content: modelContent };
        else msgs.push({ role: 'user', content: modelContent });

        const accumulatedContent = await streamReply(msgs, imageDataUrls, convId);

        if (accumulatedContent) {
          const finalContent = normalizeCaliliResponse(accumulatedContent);
          addMessage(convId, { role: 'assistant', content: finalContent });
          if (wantsVoice || voiceEnabled) speakResponse(finalContent);
        } else {
          addMessage(convId, { role: 'assistant', content: 'La respuesta llegó vacía. Toca el botón de regenerar para intentarlo de nuevo.' });
        }
        setStreamingContent('');
      }
    } catch (error: any) {
      console.error('Error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const wasAborted = error instanceof DOMException && error.name === 'AbortError' || /aborted|abort/i.test(errorMessage);
      if (!cancelRequestedRef.current && wasAborted) {
        addMessage(convId, {
          role: 'assistant',
          content: 'La respuesta tardó demasiado y fue detenida. Intenta enviarla nuevamente.',
        });
      } else if (!cancelRequestedRef.current) {
        addMessage(convId, {
          role: 'assistant',
          content: `❌ **Error:** ${errorMessage || 'No se pudo conectar con la API'}`,
        });
      }
    } finally {
      if (convId) flushPendingFiles(convId);
      setLoading(false);
      setStreamingConvId(null);
    }
  };

  // Regenerar: borra la ultima respuesta y la vuelve a producir con el
  // mismo historial, como en ChatGPT.
  const handleRegenerate = async () => {
    if (isLoading || !currentConversationId) return;
    const conv = useChatStore.getState().conversations.find((c) => c.id === currentConversationId);
    if (!conv) return;
    const lastAssistant = [...conv.messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;
    const msgs = conv.messages
      .filter((m) => m.id !== lastAssistant.id)
      .map((m) => ({ role: m.role, content: m.content }));
    if (!msgs.some((m) => m.role === 'user')) return;

    removeMessage(conv.id, lastAssistant.id);
    setLoading(true);
    setStreamingContent('');
    setStreamingConvId(conv.id);
    partialContentRef.current = '';
    cancelRequestedRef.current = false;
    try {
      const accumulatedContent = await streamReply(msgs, [], conv.id);
      if (accumulatedContent) {
        addMessage(conv.id, { role: 'assistant', content: normalizeCaliliResponse(accumulatedContent) });
      } else {
        addMessage(conv.id, { role: 'assistant', content: 'La respuesta llegó vacía. Toca el botón de regenerar para intentarlo de nuevo.' });
      }
      setStreamingContent('');
    } catch (error) {
      if (!cancelRequestedRef.current) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        addMessage(conv.id, { role: 'assistant', content: `❌ **Error:** ${errorMessage || 'No se pudo conectar con la API'}` });
      }
    } finally {
      flushPendingFiles(conv.id);
      setLoading(false);
      setStreamingConvId(null);
    }
  };

  // Editar un mensaje propio: corta la conversacion ahi y reenvia el texto
  // nuevo, como en ChatGPT.
  const handleEditMessage = (messageId: string, newText: string) => {
    if (!currentConversationId || isLoading || !newText.trim()) return;
    truncateConversation(currentConversationId, messageId);
    void handleSendMessage(newText.trim());
  };

  const stopResponse = () => {
    cancelRequestedRef.current = true;
    activeRequestControllerRef.current?.abort();
    voiceService.stop();
    // Lo ya transmitido se CONSERVA como mensaje: antes Detener borraba
    // el 100% de lo que Calili ya habia escrito.
    const partial = normalizeCaliliResponse(partialContentRef.current).trim();
    const convId = useChatStore.getState().currentConversationId;
    if (partial && convId) {
      addMessage(convId, { role: 'assistant', content: `${partial}\n\n*(Respuesta detenida por ti)*` });
      flushPendingFiles(convId);
    }
    partialContentRef.current = '';
    setStreamingContent('');
    setStreamingConvId(null);
    setLoading(false);
  };

  const showStreamingHere = streamingConvId !== null && streamingConvId === currentConversationId;
  const displayMessages = [
    ...(currentConversation?.messages || []),
    ...(showStreamingHere && isLoading && !streamingContent ? [{
      id: 'loading',
      role: 'assistant' as const,
      content: 'Calili está preparando tu respuesta...',
      timestamp: Date.now(),
    }] : []),
    ...(showStreamingHere && streamingContent ? [{
      id: 'streaming',
      role: 'assistant' as const,
      content: streamingContent,
      timestamp: Date.now(),
    }] : []),
  ];

  if (authStatus === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-chat-bg text-white">
        <p className="text-white/60">Cargando Calili…</p>
      </div>
    );
  }

  if (authStatus === 'signedOut') {
    return <AuthScreen />;
  }

  return (
    <div
      className="relative flex h-screen bg-chat-bg text-white overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <Sidebar userEmail={userEmail} onSignOut={signOut} />
      <main className="flex-1 flex flex-col min-h-0 min-w-0 w-full">
        <MessageList messages={displayMessages} files={generatedFiles} isLoading={isLoading} onRegenerate={handleRegenerate} onEditMessage={handleEditMessage} onSuggestion={(text) => void handleSendMessage(text)} />
        <InstallBanner />
        <InputBox onSendMessage={handleSendMessage} onStopMessage={stopResponse} isLoading={isLoading} onVoiceMode={() => setVoiceModeOpen(true)} />
      </main>
      {voiceModeOpen && (
        <VoiceMode
          onClose={() => setVoiceModeOpen(false)}
          onFile={(file) => { const cid = useChatStore.getState().currentConversationId; if (cid) { addGeneratedFile(cid, file); flushPendingFiles(cid); } }}
        />
      )}
    </div>
  );
}
