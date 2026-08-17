'use client';

import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/store/chat-store';
import { useSettingsStore } from '@/store/settings-store';
import { Sidebar } from '@/components/Sidebar';
import { MessageList } from '@/components/MessageList';
import { InputBox } from '@/components/InputBox';

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

  const { voiceEnabled, voiceGender, imageSize } = useSettingsStore();
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
    if (!voiceEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;

    window.speechSynthesis.cancel();

    // Limpiar markdown para la voz
    const cleanText = text
      .replace(/!\[.*?\]\(.*?\)/g, 'imagen generada')
      .replace(/\[.*?\]\(.*?\)/g, '')
      .replace(/#{1,6}\s/g, '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/`/g, '')
      .substring(0, 500); // Limitar longitud para voz

    const utterance = new SpeechSynthesisUtterance(cleanText);

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      let selectedVoice = voices.find(voice => {
        const lowerName = voice.name.toLowerCase();
        const lowerLang = voice.lang.toLowerCase();
        if (!lowerLang.includes('es')) return false;
        if (voiceGender === 'female') {
          return lowerName.includes('female') || lowerName.includes('woman') ||
                 lowerName.includes('mónica') || lowerName.includes('lucia') || lowerName.includes('paulina');
        } else {
          return lowerName.includes('male') || lowerName.includes('man') ||
                 lowerName.includes('diego') || lowerName.includes('juan');
        }
      });

      if (!selectedVoice) {
        selectedVoice = voices.find(v => v.lang.toLowerCase().includes('es'));
      }

      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.rate = 1.0;
      utterance.pitch = voiceGender === 'female' ? 1.1 : 0.9;
      utterance.volume = 1.0;
      window.speechSynthesis.speak(utterance);
    };

    if (window.speechSynthesis.getVoices().length > 0) {
      loadVoices();
    } else {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  };

  const handleSendMessage = async (content: string) => {
    let convId = currentConversationId;

    if (!convId) {
      convId = createConversation();
    }

    addMessage(convId, { role: 'user', content });

    setLoading(true);
    setStreamingContent('');
    cancelRequestedRef.current = false;

    const wantsImage = /\b(crea|genera|haz|dibuja|diseña|diseña)\b[\s\S]{0,80}\b(imagen|foto|dibujo|ilustraci[oó]n|retrato)\b/i.test(content) ||
      /\b(imagen|foto|dibujo|ilustraci[oó]n)\b[\s\S]{0,80}\b(crea|genera|haz|dibuja)\b/i.test(content);
    const wantsWeb = /\b(busca|buscar|internet|web|actual|hoy|noticias|noticia|precio|clima|cotizaci[oó]n|[uú]ltimas|reciente)\b/i.test(content);
    const wantsVoice = /\b(habla|hablando|voz|en voz alta|lee|leer)\b/i.test(content);
    const wantsDocument = /\b(crea|genera|haz|prepara|elabora|descarga)\b[\s\S]{0,100}\b(documento|archivo|informe|reporte|carta|curr[ií]culum|markdown|\.md|\.txt)\b/i.test(content);

    let requestTimeout: number | null = null;

    try {
      if (wantsImage) {
        const response = await fetch('/api/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: content, size: imageSize, quality: 'hd' }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || `Error ${response.status}`);
        }

        const data = await response.json();
        const imageUrl = data.data?.[0]?.url;
        const revisedPrompt = data.data?.[0]?.revised_prompt;

        if (imageUrl) {
          addMessage(convId, {
            role: 'assistant',
            content: `![Imagen generada](${imageUrl})\n\n*${revisedPrompt || content}*`,
          });
        } else {
          throw new Error('No se pudo generar la imagen');
        }
      } else {
        const msgs = (currentConversation?.messages || []).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        // Incluir el mensaje del usuario actual
        msgs.push({ role: 'user', content });

        let webContext = '';
        if (wantsWeb) {
          const searchController = new AbortController();
          const searchTimeout = window.setTimeout(() => searchController.abort(), 3000);
          try {
            const searchResponse = await fetch('/api/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: content }),
              signal: searchController.signal,
            });
            if (searchResponse.ok) {
              const searchData = await searchResponse.json();
              webContext = searchData.context || '';
            }
          } catch {
            // La respuesta de Calili no debe quedar bloqueada por una búsqueda lenta.
          } finally {
            window.clearTimeout(searchTimeout);
          }
        }

        const chatController = new AbortController();
        activeRequestControllerRef.current = chatController;
        requestTimeout = window.setTimeout(() => chatController.abort(), 25000);
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: msgs, webContext, wantsDocument }),
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
          if (wantsDocument) {
            const blob = new Blob([finalContent], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'calili-documento.md';
            link.click();
            URL.revokeObjectURL(url);
          }
        } else {
          addMessage(convId, { role: 'assistant', content: '⚠️ La IA no devolvió contenido. Revisa la conexión del Gateway.' });
        }
        setStreamingContent('');
      }
    } catch (error: any) {
      console.error('Error:', error);
      if (!cancelRequestedRef.current) {
        addMessage(convId, {
          role: 'assistant',
          content: `❌ **Error:** ${error.message || 'No se pudo conectar con la API'}`,
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
