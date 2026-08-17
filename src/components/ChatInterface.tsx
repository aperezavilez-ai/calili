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
  } = useChatStore();

  const { voiceEnabled, voiceGender } = useSettingsStore();
  const [streamingContent, setStreamingContent] = useState('');

  const currentConversation = conversations.find((c) => c.id === currentConversationId);

  useEffect(() => {
    // Crear conversación inicial si no hay ninguna
    if (conversations.length === 0) {
      createConversation();
    }
  }, []);

  // Reproducir respuesta con voz automáticamente
  const speakResponse = (text: string) => {
    if (!voiceEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;

    window.speechSynthesis.cancel(); // Cancelar voz anterior

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();

    // Seleccionar voz según género configurado
    let selectedVoice = voices.find(voice => {
      const lowerName = voice.name.toLowerCase();
      const lowerLang = voice.lang.toLowerCase();

      if (!lowerLang.includes('es')) return false;

      if (voiceGender === 'female') {
        return lowerName.includes('female') ||
               lowerName.includes('woman') ||
               lowerName.includes('mónica') ||
               lowerName.includes('lucia') ||
               lowerName.includes('paulina');
      } else {
        return lowerName.includes('male') ||
               lowerName.includes('man') ||
               lowerName.includes('diego') ||
               lowerName.includes('juan');
      }
    });

    if (!selectedVoice) {
      selectedVoice = voices.find(v => v.lang.toLowerCase().includes('es'));
    }

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    utterance.rate = 1.0;
    utterance.pitch = voiceGender === 'female' ? 1.1 : 0.9;
    utterance.volume = 1.0;

    window.speechSynthesis.speak(utterance);
  };

  const handleSendMessage = async (content: string) => {
    if (!currentConversationId) {
      const newId = createConversation();
      setTimeout(() => handleSendMessage(content), 100);
      return;
    }

    // Agregar mensaje del usuario
    addMessage(currentConversationId, {
      role: 'user',
      content,
    });

    setLoading(true);
    setStreamingContent('');

    // Detectar si el usuario quiere generar una imagen
    const isImageRequest = /genera|crea|dibuja|haz|diseña|imagen|foto|picture|draw/i.test(content) &&
                          /imagen|foto|dibujo|picture|image/i.test(content);

    try {
      if (isImageRequest) {
        // Generación de imagen
        const response = await fetch('/api/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: content,
            size: imageSize,
            quality: 'hd',
          }),
        });

        if (!response.ok) {
          throw new Error('Error al generar imagen');
        }

        const data = await response.json();
        const imageUrl = data.data[0].url;
        const revisedPrompt = data.data[0].revised_prompt;

        addMessage(currentConversationId, {
          role: 'assistant',
          content: `![Imagen generada](${imageUrl})\n\n**Prompt mejorado:** ${revisedPrompt || content}`,
        });
      } else {
        // Chat normal o con razonamiento
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: currentConversation?.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })) || [],
            mode: aiMode,
          }),
        });

        if (!response.ok) {
          throw new Error('Error al obtener respuesta');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No se pudo leer la respuesta');

        const decoder = new TextDecoder();
        let accumulatedContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  accumulatedContent += parsed.content;
                  setStreamingContent(accumulatedContent);
                }
              } catch (e) {
                console.error('Error parsing SSE:', e);
              }
            }
          }
        }

        // Agregar mensaje completo
        if (accumulatedContent) {
          addMessage(currentConversationId, {
            role: 'assistant',
            content: accumulatedContent,
          });

          // Reproducir con voz automáticamente
          speakResponse(accumulatedContent);
        }
        setStreamingContent('');
      }
    } catch (error: any) {
      console.error('Error:', error);
      addMessage(currentConversationId, {
        role: 'assistant',
        content: `❌ Error: ${error.message || 'No se pudo obtener respuesta'}`,
      });
    } finally {
      setLoading(false);
    }
  };

  const displayMessages = currentConversation?.messages || [];

  // Agregar mensaje de streaming si está activo
  if (streamingContent) {
    displayMessages.push({
      id: 'streaming',
      role: 'assistant',
      content: streamingContent,
      timestamp: Date.now(),
    });
  }

  return (
    <div className="flex h-screen bg-chat-bg text-white">
      <Sidebar />
      <main className="flex-1 flex flex-col">
        <MessageList messages={displayMessages} />
        <InputBox onSendMessage={handleSendMessage} isLoading={isLoading} />
      </main>
    </div>
  );
}
