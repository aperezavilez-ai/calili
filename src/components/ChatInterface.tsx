'use client';

import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/store/chat-store';
import { useSettingsStore } from '@/store/settings-store';
import { Sidebar } from '@/components/Sidebar';
import { MessageList } from '@/components/MessageList';
import { InputBox } from '@/components/InputBox';
import { voiceService } from '@/lib/voice-service';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { fetchConversations, uploadLocalConversation } from '@/lib/chat-db';
import { AuthScreen } from '@/components/AuthScreen';
import VoiceMode from '@/components/VoiceMode';
import { normalizeCaliliResponse } from '@/lib/response-policy';
import { Download } from 'lucide-react';

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
  } = useChatStore();

  const [authStatus, setAuthStatus] = useState<'checking' | 'local' | 'signedOut' | 'signedIn'>('checking');
  const [userEmail, setUserEmail] = useState('');

  const { voiceEnabled, voiceGender } = useSettingsStore();
  const [streamingContent, setStreamingContent] = useState('');
  const [generatedFiles, setGeneratedFiles] = useState<Array<{ id: string; name: string; mime: string; base64: string }>>([]);
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);

  const currentConversation = conversations.find((c) => c.id === currentConversationId);

  useEffect(() => {
    const closeMobileSidebar = window.setTimeout(() => {
      if (window.innerWidth < 768 && isSidebarOpen) toggleSidebar();
    }, 500);

    return () => window.clearTimeout(closeMobileSidebar);
  }, [isSidebarOpen, toggleSidebar]);

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
      try {
        const remote = await fetchConversations(user.id);
        if (cancelled) return;
        if (remote.length > 0) {
          replaceConversations(remote);
        } else {
          // Primer ingreso: subir el historial local para no perderlo.
          const local = useChatStore.getState().conversations;
          for (const conversation of local) {
            await uploadLocalConversation(user.id, conversation);
          }
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

  useEffect(() => {
    setGeneratedFiles([]);
  }, [currentConversationId]);

  const downloadToolFile = (file: { name: string; mime: string; base64: string }) => {
    const binary = atob(file.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
  };

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
    cancelRequestedRef.current = false;

    const wantsVoice = /\b(habla|hablando|voz|en voz alta|lee|leer)\b/i.test(content);
    let requestTimeout: number | null = null;

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
        const fileResponse = await fetch('/api/files', { method: 'POST', body: formData });
        if (!fileResponse.ok) {
          const errorData = await fileResponse.json().catch(() => ({}));
          throw new Error(errorData.error || 'No se pudieron analizar los archivos.');
        }
        const fileData = await fileResponse.json();
        const extracted = (fileData.attachments ?? []) as Array<{ name: string; text?: string; analyzableImage?: boolean }>;
        const extractedText = extracted.filter((file) => file.text).map((file) => `--- ${file.name} ---\n${file.text}`).join('\n\n');
        if (extractedText) modelContent += `\n\nContenido extraído de los archivos:\n${extractedText}`;
      }

      {
        const msgs = (currentConversation?.messages || []).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        // Incluir el mensaje del usuario actual
        msgs.push({ role: 'user', content: modelContent });

        const chatController = new AbortController();
        activeRequestControllerRef.current = chatController;
        requestTimeout = window.setTimeout(() => chatController.abort(), 120000);
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: msgs, images: imageDataUrls }),
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
                if (parsed.file) {
                  setGeneratedFiles((prev) => [
                    ...prev,
                    { id: `${Date.now()}-${prev.length}`, name: parsed.file.name, mime: parsed.file.mime, base64: parsed.file.base64 },
                  ]);
                }
                if (parsed.content) {
                  accumulatedContent += parsed.content;
                  setStreamingContent(normalizeCaliliResponse(accumulatedContent));
                }
              } catch (parseError) {
                if (parseError instanceof Error && parseError.message) throw parseError;
              }
            }
          }
        }

        if (accumulatedContent) {
          const finalContent = normalizeCaliliResponse(accumulatedContent);
          addMessage(convId, { role: 'assistant', content: finalContent });
          if (wantsVoice || voiceEnabled) speakResponse(finalContent);
        } else {
          addMessage(convId, { role: 'assistant', content: '⚠️ NEXUS no devolvió contenido. Revisa la configuración del motor.' });
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
      if (requestTimeout !== null) window.clearTimeout(requestTimeout);
      activeRequestControllerRef.current = null;
      setLoading(false);
    }
  };

  const stopResponse = () => {
    cancelRequestedRef.current = true;
    activeRequestControllerRef.current?.abort();
    voiceService.stop();
    setStreamingContent('');
    setLoading(false);
  };

  const displayMessages = [
    ...(currentConversation?.messages || []),
    ...(isLoading && !streamingContent ? [{
      id: 'loading',
      role: 'assistant' as const,
      content: 'Calili está preparando tu respuesta...',
      timestamp: Date.now(),
    }] : []),
    ...(streamingContent ? [{
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
    <div className="relative flex h-screen bg-chat-bg text-white overflow-hidden">
      <Sidebar userEmail={userEmail} onSignOut={signOut} />
      <main className="flex-1 flex flex-col min-h-0 min-w-0 w-full">
        <MessageList messages={displayMessages} />
        {generatedFiles.length > 0 && (
          <div className="border-t border-white/10 bg-chat-bg px-4 py-3">
            <div className="mx-auto flex max-w-3xl flex-wrap gap-2">
              {generatedFiles.map((file) => (
                <button
                  key={file.id}
                  onClick={() => downloadToolFile(file)}
                  className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-500/25"
                  title="Descargar archivo"
                >
                  <Download className="h-4 w-4" /> {file.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <InputBox onSendMessage={handleSendMessage} onStopMessage={stopResponse} isLoading={isLoading} onVoiceMode={() => setVoiceModeOpen(true)} />
      </main>
      {voiceModeOpen && (
        <VoiceMode
          onClose={() => setVoiceModeOpen(false)}
          onFile={(file) => setGeneratedFiles((current) => [...current, file])}
        />
      )}
    </div>
  );
}
