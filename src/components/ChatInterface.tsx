'use client';

import { useEffect, useState } from 'react';
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

  const { voiceEnabled, voiceGender, aiMode, imageSize } = useSettingsStore();
  const [streamingContent, setStreamingContent] = useState('');

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

  const handleSendMessage = async (content: string, mode = aiMode) => {
    let convId = currentConversationId;

    if (!convId) {
      convId = createConversation();
    }

    addMessage(convId, { role: 'user', content });

    setLoading(true);
    setStreamingContent('');

    const isImageRequest = mode === 'image';

    try {
      if (isImageRequest) {
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

        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: msgs, mode }),
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
                  setStreamingContent(accumulatedContent);
                }
              } catch {}
            }
          }
        }

        if (accumulatedContent) {
          addMessage(convId, { role: 'assistant', content: accumulatedContent });
          speakResponse(accumulatedContent);
        } else {
          addMessage(convId, { role: 'assistant', content: '⚠️ No se recibió respuesta. Verifica que la API GPT esté configurada correctamente.' });
        }
        setStreamingContent('');
      }
    } catch (error: any) {
      console.error('Error:', error);
      addMessage(convId, {
        role: 'assistant',
        content: `❌ **Error:** ${error.message || 'No se pudo conectar con la API'}`,
      });
    } finally {
      setLoading(false);
    }
  };

  const displayMessages = [
    ...(currentConversation?.messages || []),
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
      <main className="flex-1 flex flex-col min-w-0 w-full">
        <MessageList messages={displayMessages} />
        <InputBox onSendMessage={handleSendMessage} isLoading={isLoading} />
      </main>
    </div>
  );
}
