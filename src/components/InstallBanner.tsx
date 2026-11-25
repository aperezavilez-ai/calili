'use client';

import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'calili-install-dismissed';
const DISMISS_DAYS = 1;

export function InstallBanner() {
  const [mode, setMode] = useState<'hidden' | 'android' | 'android-manual' | 'ios'>('hidden');
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;
    try {
      const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
      if (dismissedAt && Date.now() - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000) return;
    } catch { /* sin almacenamiento: se muestra */ }

    const ua = window.navigator.userAgent || '';
    if (/iphone|ipad|ipod/i.test(ua)) {
      setMode('ios');
      return;
    }
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setMode('android');
    };
    const handleInstalled = () => setMode('hidden');
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    // Si Chrome no ofrece la instalacion por su cuenta (llega poca
    // senal de uso, o la pagina se abrio dentro de otra app), el aviso
    // aparece igual con los pasos del menu del navegador: la puerta de
    // instalacion no depende de que el evento se dispare.
    const fallback = window.setTimeout(() => {
      setMode((current) => (current === 'hidden' ? 'android-manual' : current));
    }, 2500);
    return () => {
      window.clearTimeout(fallback);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  if (mode === 'hidden') return null;

  const dismiss = () => {
    try { window.localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* nada */ }
    setMode('hidden');
  };

  const installAndroid = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'accepted') setMode('hidden');
  };

  return (
    <div className="border-t border-white/10 bg-chat-bg px-4 pt-3">
      <div className="mx-auto max-w-3xl rounded-2xl border border-sky-300/25 bg-sky-500/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 text-white">
            <Download className="h-5 w-5" />
          </span>
          <p className="flex-1 text-sm leading-snug text-white/85">
            <strong className="text-white">Instala Calili</strong> en tu pantalla de inicio: abre como app, a pantalla completa y se actualiza sola.
          </p>
          {mode === 'android' ? (
            <button
              onClick={installAndroid}
              className="flex-shrink-0 rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-slate-900 hover:bg-white/90"
            >
              Instalar
            </button>
          ) : (
            <button
              onClick={() => setShowSteps((v) => !v)}
              className="flex-shrink-0 rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-slate-900 hover:bg-white/90"
            >
              Cómo instalar
            </button>
          )}
          <button
            onClick={dismiss}
            className="flex-shrink-0 rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
            title="Ahora no"
            aria-label="Descartar aviso de instalación"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {mode === 'ios' && showSteps && (
          <ol className="mt-3 space-y-1.5 text-sm text-white/75">
            <li className="flex items-center gap-2">
              <Share className="h-4 w-4 flex-shrink-0 text-sky-300" />
              1. Toca <strong className="text-white">Compartir</strong> en la barra de Safari (el cuadro con la flecha hacia arriba).
            </li>
            <li>2. Elige <strong className="text-white">«Agregar a pantalla de inicio»</strong>.</li>
            <li>3. Toca <strong className="text-white">Agregar</strong> y listo: Calili queda con su icono como cualquier app.</li>
          </ol>
        )}
        {mode === 'android-manual' && showSteps && (
          <ol className="mt-3 space-y-1.5 text-sm text-white/75">
            <li>1. Toca el menú <strong className="text-white">⋮</strong> de Chrome, arriba a la derecha.</li>
            <li>2. Elige <strong className="text-white">«Instalar app»</strong> o <strong className="text-white">«Agregar a pantalla de inicio»</strong>.</li>
            <li>3. Confirma con <strong className="text-white">Instalar</strong> y listo: Calili queda con su icono como cualquier app.</li>
          </ol>
        )}
      </div>
    </div>
  );
}
