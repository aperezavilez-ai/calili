import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  insertConversation,
  insertMessage,
  updateConversationTitleDb,
  deleteConversationDb,
  deleteMessageDb,
} from '@/lib/chat-db';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  // Resumen rodante de los mensajes antiguos (cache local del cliente).
  summary?: string;
  summaryUpTo?: number;
}

interface ChatStore {
  conversations: Conversation[];
  currentConversationId: string | null;
  isLoading: boolean;
  isDarkMode: boolean;
  isSidebarOpen: boolean;
  // Usuario de Supabase con sesión activa; si hay uno, el store sincroniza
  // cada cambio contra la base de datos. Sin sesión, todo queda local.
  dbUserId: string | null;

  // Actions
  createConversation: () => string;
  deleteConversation: (id: string) => void;
  setCurrentConversation: (id: string) => void;
  addMessage: (conversationId: string, message: Omit<Message, 'id' | 'timestamp'>) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
  truncateConversation: (conversationId: string, messageId: string) => void;
  setConversationSummary: (conversationId: string, summary: string, summaryUpTo: number) => void;
  updateConversationTitle: (id: string, title: string) => void;
  setLoading: (loading: boolean) => void;
  toggleDarkMode: () => void;
  toggleSidebar: () => void;
  clearAllConversations: () => void;
  setDbUser: (userId: string | null) => void;
  replaceConversations: (conversations: Conversation[]) => void;
}

// La sincronización nunca bloquea la interfaz: si la red falla, el dato
// ya quedó en el respaldo local y el error solo se registra en consola.
function sync(promise: Promise<void>) {
  promise.catch((error) => console.error('Calili: error de sincronización', error));
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      conversations: [],
      currentConversationId: null,
      isLoading: false,
      isDarkMode: true,
      isSidebarOpen: true,
      dbUserId: null,

      createConversation: () => {
        const id = crypto.randomUUID();
        const now = Date.now();
        const newConversation: Conversation = {
          id,
          title: 'Nueva conversación',
          messages: [],
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({
          conversations: [newConversation, ...state.conversations],
          currentConversationId: id,
        }));

        const { dbUserId } = get();
        if (dbUserId) sync(insertConversation(dbUserId, newConversation));

        return id;
      },

      deleteConversation: (id) => {
        set((state) => {
          const filtered = state.conversations.filter((c) => c.id !== id);
          const newCurrentId =
            state.currentConversationId === id
              ? filtered[0]?.id || null
              : state.currentConversationId;

          return {
            conversations: filtered,
            currentConversationId: newCurrentId,
          };
        });

        if (get().dbUserId) sync(deleteConversationDb(id));
      },

      setCurrentConversation: (id) => {
        set({ currentConversationId: id });
      },

      addMessage: (conversationId, message) => {
        const newMessage: Message = {
          ...message,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        };

        const previousTitle = get().conversations.find((c) => c.id === conversationId)?.title;

        set((state) => ({
          conversations: state.conversations.map((conv) => {
            if (conv.id === conversationId) {
              const updatedMessages = [...conv.messages, newMessage];

              // Auto-generar título con el primer mensaje del usuario
              let title = conv.title;
              if (conv.messages.length === 0 && message.role === 'user') {
                title = message.content.slice(0, 30) + (message.content.length > 30 ? '...' : '');
              }

              return {
                ...conv,
                messages: updatedMessages,
                title,
                updatedAt: Date.now(),
              };
            }
            return conv;
          }),
        }));

        if (get().dbUserId) {
          sync(insertMessage(conversationId, newMessage));
          const newTitle = get().conversations.find((c) => c.id === conversationId)?.title;
          if (newTitle && previousTitle && newTitle !== previousTitle) {
            sync(updateConversationTitleDb(conversationId, newTitle));
          }
        }
      },

      removeMessage: (conversationId, messageId) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? { ...conv, messages: conv.messages.filter((m) => m.id !== messageId), updatedAt: Date.now() }
              : conv
          ),
        }));
        if (get().dbUserId) sync(deleteMessageDb(messageId));
      },

      truncateConversation: (conversationId, messageId) => {
        const conv = get().conversations.find((c) => c.id === conversationId);
        if (!conv) return;
        const idx = conv.messages.findIndex((m) => m.id === messageId);
        if (idx < 0) return;
        const removed = conv.messages.slice(idx);
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, messages: c.messages.slice(0, idx), updatedAt: Date.now() }
              : c
          ),
        }));
        if (get().dbUserId) removed.forEach((m) => sync(deleteMessageDb(m.id)));
      },

      // Resumen rodante de la parte antigua (cache local; el servidor lo
      // genera y lo emite por SSE cuando la conversacion crece).
      setConversationSummary: (conversationId, summary, summaryUpTo) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId ? { ...conv, summary, summaryUpTo } : conv
          ),
        }));
      },

      updateConversationTitle: (id, title) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === id ? { ...conv, title, updatedAt: Date.now() } : conv
          ),
        }));

        if (get().dbUserId) sync(updateConversationTitleDb(id, title));
      },

      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      toggleDarkMode: () => {
        set((state) => ({ isDarkMode: !state.isDarkMode }));
      },

      toggleSidebar: () => {
        set((state) => ({ isSidebarOpen: !state.isSidebarOpen }));
      },

      clearAllConversations: () => {
        set({
          conversations: [],
          currentConversationId: null,
        });
      },

      setDbUser: (userId) => {
        set({ dbUserId: userId });
      },

      replaceConversations: (conversations) => {
        set((state) => ({
          conversations,
          currentConversationId:
            state.currentConversationId && conversations.some((c) => c.id === state.currentConversationId)
              ? state.currentConversationId
              : conversations[0]?.id || null,
        }));
      },
    }),
    {
      name: 'calili-chat-storage',
      // Solo se persiste el respaldo local; la sesión y la carga no.
      partialize: (state) => ({
        conversations: state.conversations,
        currentConversationId: state.currentConversationId,
        isDarkMode: state.isDarkMode,
        isSidebarOpen: state.isSidebarOpen,
      }),
      // Un request interrumpido no debe reabrir la app con el boton bloqueado.
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<ChatStore>),
        isLoading: false,
      }),
    }
  )
);
