'use client';

import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/store/chat-store';
import { useSettingsStore } from '@/store/settings-store';
import { Sidebar } from '@/components/Sidebar';
import { MessageList } from '@/components/MessageList';
import { InputBox } from '@/components/InputBox';
import { voiceService } from '@/lib/voice-service';

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
  } = useChatStore();

  const { voiceEnabled, voiceGender } = useSettingsStore();
  const [streamingContent, setStreamingContent] = useState('');
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);

  const normalizeCaliliResponse = (text: string) => text
    .replace(/\b(?:soy|eres)\s+(?:un\s+)?(?:asistente\s+)?(?:basado|impulsado)\s+en\s+(?:GPT(?:-?5(?:\.5)?)?|ChatGPT)\b[^.?!]*(?:[.?!]|$)/gi, 'Soy Calili, tu asistente virtual.')
    .replace(/\b(?:GPT(?:-?5(?:\.5)?)?|ChatGPT|ME\.AI|APICredits)\b/gi, 'Calili');

  const currentConversation = conversations.find((c) => c.id === currentConversationId);

  useEffect(() => {
    const closeMobileSidebar = window.setTimeout(() => {
      if (window.innerWidth < 768 && isSidebarOpen) toggleSidebar();
    }, 500);

    return () => window.clearTimeout(closeMobileSidebar);
  }, [isSidebarOpen, toggleSidebar]);

  const speakResponse = (text: string) => {
    if (voiceEnabled) voiceService.speak(text, voiceGender);
  };

  const downloadGeneratedFile = async (content: string, format: 'md' | 'pdf' | 'docx') => {
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, format, title: 'calili-documento' }),
    });
    if (!response.ok) throw new Error('No se pudo generar el archivo descargable.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `calili-documento.${format}`;
    link.click();
    URL.revokeObjectURL(url);
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

    const normalizedIntent = content.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const wantsVoice = /\b(habla|hablando|voz|en voz alta|lee|leer)\b/i.test(content);
    const documentAction = '(?:crea(?:r|me)?|genera(?:r|me)?|haz(?:me)?|prepara(?:r|me)?|elabora(?:r|me)?|descarga(?:r|me)?)';
    const documentTarget = '(?:documento|archivo|informe|reporte|carta|curriculum|markdown|\\.md|\\.txt|pdf|word|docx)';
    const wantsDocument = new RegExp(`\\b${documentAction}\\b[\\s\\S]{0,120}\\b${documentTarget}\\b`).test(normalizedIntent) ||
      new RegExp(`\\b${documentTarget}\\b[\\s\\S]{0,120}\\b${documentAction}\\b`).test(normalizedIntent);
    const requestedFormat: 'md' | 'pdf' | 'docx' = /\b(pdf)\b/i.test(content) ? 'pdf' : /\b(word|docx)\b/i.test(content) ? 'docx' : 'md';

    let requestTimeout: number | null = null;

    try {
      let modelContent = content;
      if (files.length > 0) {
        const formData = new FormData();
        files.forEach((file) => formData.append('files', file));
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
          body: JSON.stringify({ messages: msgs, wantsDocument }),
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
          if (wantsDocument) await downloadGeneratedFile(finalContent, requestedFormat);
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

  return (
    <div className="relative flex h-screen bg-chat-bg text-white overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col min-h-0 min-w-0 w-full">
        <MessageList messages={displayMessages} />
        <InputBox onSendMessage={handleSendMessage} onStopMessage={stopResponse} isLoading={isLoading} />
      </main>
    </div>
  );
}
