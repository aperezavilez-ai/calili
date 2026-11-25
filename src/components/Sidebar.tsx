'use client';

import { apiFetch } from '@/lib/api-client';
import { useChatStore } from '@/store/chat-store';
import { useSettingsStore } from '@/store/settings-store';
import { MessageSquarePlus, Trash2, Edit2, Check, X, Menu, Settings, Download, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { voiceService } from '@/lib/voice-service';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function usePwaInstall() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    setIsStandalone(
      window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true,
    );
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => setInstallEvent(null);

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'accepted') setInstallEvent(null);
  };

  return { canInstall: Boolean(installEvent), install, isStandalone };
}

function useIosInstallHint() {
  const [showIosInstall, setShowIosInstall] = useState(false);
  useEffect(() => {
    const ua = window.navigator.userAgent || '';
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setShowIosInstall(isIos && !standalone);
  }, []);
  return showIosInstall;
}

export function Sidebar({ userEmail, onSignOut }: { userEmail?: string; onSignOut?: () => void }) {
  const {
    conversations,
    currentConversationId,
    createConversation,
    deleteConversation,
    setCurrentConversation,
    updateConversationTitle,
    isSidebarOpen,
    toggleSidebar,
    isDarkMode,
    toggleDarkMode,
  } = useChatStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const { voiceEnabled, voiceGender, setVoiceEnabled, setVoiceGender } = useSettingsStore();
  const { canInstall, install, isStandalone } = usePwaInstall();
  const showIosInstall = useIosInstallHint();
  const [iosHintOpen, setIosHintOpen] = useState(false);
  const asideTouchX = useRef<number | null>(null);

  const toggleVoice = () => {
    if (voiceEnabled) voiceService.stop();
    setVoiceEnabled(!voiceEnabled);
  };

  // Exportar la conversacion a Word usando /api/export (la ruta existia
  // desde el proyecto original pero ningun boton la llamaba).
  const handleExport = async (conv: { title: string; messages: Array<{ role: string; content: string }> }) => {
    try {
      const lines: string[] = [`# ${conv.title}`, ''];
      for (const m of conv.messages) {
        lines.push(m.role === 'user' ? `**Tú:** ${m.content}` : `**Calili:** ${m.content}`, '');
      }
      const res = await apiFetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: lines.join('\n'), format: 'docx', title: conv.title }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${conv.title.replace(/[^\wáéíóúñ -]/gi, '').trim().slice(0, 60) || 'conversacion'}.docx`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { /* exportacion no disponible */ }
  };

  const handleStartEdit = (id: string, title: string) => {
    setEditingId(id);
    setEditTitle(title);
  };

  const handleSaveEdit = (id: string) => {
    if (editTitle.trim()) {
      updateConversationTitle(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
  };

  const groupedConversations = conversations.reduce((acc, conv) => {
    const date = new Date(conv.createdAt);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let key = 'Más antiguas';

    if (date.toDateString() === today.toDateString()) {
      key = 'Hoy';
    } else if (date.toDateString() === yesterday.toDateString()) {
      key = 'Ayer';
    } else if (date > new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)) {
      key = 'Últimos 7 días';
    } else if (date > new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)) {
      key = 'Últimos 30 días';
    }

    if (!acc[key]) acc[key] = [];
    acc[key].push(conv);
    return acc;
  }, {} as Record<string, typeof conversations>);

  if (!isSidebarOpen) {
    return (
      <button
        onClick={toggleSidebar}
        className="fixed top-4 left-4 z-50 p-2 rounded-lg bg-chat-sidebar hover:bg-chat-hover transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-black/50 md:hidden"
        onClick={toggleSidebar}
        aria-hidden="true"
      />
      <aside
        className="fixed inset-y-0 left-0 z-40 w-[min(80vw,16rem)] bg-chat-sidebar flex flex-col border-r border-white/10 md:relative md:w-64 animate-[calili-slide-in_0.25s_ease-out]"
        onTouchStart={(e) => { asideTouchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (asideTouchX.current === null) return;
          const dx = e.changedTouches[0].clientX - asideTouchX.current;
          asideTouchX.current = null;
          if (dx < -64 && window.innerWidth < 768) toggleSidebar();
        }}
      >
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={toggleSidebar}
            className="p-2 rounded-lg hover:bg-chat-hover transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded-lg hover:bg-chat-hover transition-colors"
            title="Configuración"
          >
            <Settings className="w-5 h-5" />
          </button>
          {!isStandalone && (
            <button
              onClick={() => { if (canInstall) { void install(); } else { setIosHintOpen((v) => !v); } }}
              className="p-2 rounded-lg hover:bg-chat-hover transition-colors text-cyan-300"
              title="Instalar Calili"
              aria-label="Instalar Calili"
            >
              <Download className="w-5 h-5" />
            </button>
          )}
        </div>

        {iosHintOpen && !isStandalone && (
          showIosInstall ? (
            <div className="mb-4 p-4 rounded-lg bg-cyan-500/10 border border-cyan-300/20 space-y-2 text-sm text-white/80">
              <p className="font-semibold text-cyan-200">Instalar Calili en iPhone</p>
              <p>1. Toca el botón <strong>Compartir</strong> de Safari (el cuadro con la flecha hacia arriba).</p>
              <p>2. Elige <strong>«Agregar a pantalla de inicio»</strong>.</p>
              <p>3. Toca <strong>Agregar</strong>. Calili queda con su icono, a pantalla completa, y se actualiza sola con cada despliegue.</p>
            </div>
          ) : (
            <div className="mb-4 p-4 rounded-lg bg-cyan-500/10 border border-cyan-300/20 space-y-2 text-sm text-white/80">
              <p className="font-semibold text-cyan-200">Instalar Calili en Android</p>
              <p>1. Toca el menú <strong>⋮</strong> de Chrome, arriba a la derecha.</p>
              <p>2. Elige <strong>«Instalar app»</strong> o <strong>«Agregar a pantalla de inicio»</strong>.</p>
              <p>3. Confirma con <strong>Instalar</strong>. Calili queda con su icono, a pantalla completa, y se actualiza sola con cada despliegue.</p>
              <p className="text-white/50">Si abriste el enlace dentro de otra app (WhatsApp, Facebook), primero ábrelo en Chrome: desde esos navegadores internos no se puede instalar.</p>
            </div>
          )
        )}

        {/* Panel de configuración de voz */}
        {showSettings && (
          <div className="mb-4 p-4 rounded-lg bg-white/5 border border-white/10 space-y-3">
            <h3 className="font-semibold text-sm mb-2">🔊 Configuración de Voz</h3>

            <label className="flex items-center justify-between">
              <span className="text-sm text-white/70">Respuestas con voz</span>
              <button
                onClick={toggleVoice}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  voiceEnabled ? 'bg-purple-600' : 'bg-white/20'
                }`}
              >
                <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  voiceEnabled ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            </label>

            {voiceEnabled && (
              <div className="space-y-2">
                <span className="text-xs text-white/50">Tipo de voz:</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setVoiceGender('male')}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors ${
                      voiceGender === 'male'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white/10 hover:bg-white/20'
                    }`}
                  >
                    🎙️ Hombre
                  </button>
                  <button
                    onClick={() => setVoiceGender('female')}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors ${
                      voiceGender === 'female'
                        ? 'bg-pink-600 text-white'
                        : 'bg-white/10 hover:bg-white/20'
                    }`}
                  >
                    🎙️ Mujer
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <button
          onClick={createConversation}
          className="w-full flex items-center gap-2 px-4 py-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
        >
          <MessageSquarePlus className="w-5 h-5" />
          <span className="font-medium">Nueva conversación</span>
        </button>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto p-2">
        {Object.entries(groupedConversations).map(([group, convs]) => (
          <div key={group} className="mb-4">
            <h3 className="text-xs font-semibold text-white/40 px-3 mb-2">{group}</h3>
            {convs.map((conv) => (
              <div
                key={conv.id}
                className={`group relative mb-1 rounded-lg transition-colors ${
                  conv.id === currentConversationId
                    ? 'bg-chat-hover'
                    : 'hover:bg-chat-hover/50'
                }`}
              >
                {editingId === conv.id ? (
                  <div className="flex items-center gap-1 p-2">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(conv.id);
                        if (e.key === 'Escape') handleCancelEdit();
                      }}
                      className="flex-1 bg-chat-input px-2 py-1 rounded text-sm outline-none"
                      autoFocus
                    />
                    <button
                      onClick={() => handleSaveEdit(conv.id)}
                      className="p-1 hover:bg-white/10 rounded"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="p-1 hover:bg-white/10 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setCurrentConversation(conv.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setCurrentConversation(conv.id); }}
                    className="w-full text-left px-3 py-2 flex items-center justify-between cursor-pointer"
                  >
                    <span className="text-sm truncate flex-1">{conv.title}</span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleExport(conv);
                        }}
                        className="p-1 hover:bg-white/10 rounded"
                        title="Exportar a Word"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEdit(conv.id, conv.title);
                        }}
                        className="p-1 hover:bg-white/10 rounded"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('¿Eliminar esta conversación?')) {
                            deleteConversation(conv.id);
                          }
                        }}
                        className="p-1 hover:bg-white/10 rounded text-red-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

        {conversations.length === 0 && (
          <div className="text-center text-white/40 text-sm mt-8">
            No hay conversaciones aún
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-white/10">
        {userEmail && (
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="truncate text-xs text-white/60" title={userEmail}>{userEmail}</span>
            <button
              onClick={onSignOut}
              className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
              title="Cerrar sesión"
            >
              <LogOut className="h-3.5 w-3.5" /> Salir
            </button>
          </div>
        )}
        <div className="text-xs text-white/40 text-center">
          <p className="font-semibold">Calili</p>
        </div>
      </div>
    </aside>
    </>

  );
}
