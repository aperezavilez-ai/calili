'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

// Actualizacion automatica de la PWA:
// - Busca versiones nuevas del service worker cada 30 minutos, al volver
//   a la pestana y al recuperar el foco (una app instalada y abierta no
//   se enteraba del despliegue hasta cerrarla y reabrirla).
// - Cuando el worker nuevo toma el control (next-pwa ya trae
//   skipWaiting + clientsClaim), recarga UNA vez para entrar directo a
//   la version nueva, avisando con una pastilla breve si la app esta
//   visible. Guarda anti-bucle: no se recarga dos veces en 30 s.
const RELOAD_GUARD_KEY = 'calili-pwa-auto-reload-at';
const UPDATE_CHECK_MS = 30 * 60 * 1000;

export function PwaUpdater() {
  const [updating, setUpdating] = useState(false);
  const hadControllerRef = useRef(false);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    hadControllerRef.current = Boolean(navigator.serviceWorker.controller);

    const reloadOnce = () => {
      if (reloadingRef.current) return;
      try {
        const last = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
        if (last && Date.now() - last < 30000) return;
        window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
      } catch { /* sin almacenamiento: se recarga igual, la guarda en memoria basta */ }
      reloadingRef.current = true;
      if (document.visibilityState === 'visible') {
        setUpdating(true);
        window.setTimeout(() => window.location.reload(), 1600);
      } else {
        window.location.reload();
      }
    };

    const onControllerChange = () => {
      // Sin controlador previo es la PRIMERA instalacion del worker:
      // no hay version anterior que reemplazar y no se recarga.
      if (!hadControllerRef.current) return;
      reloadOnce();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const checkForUpdate = () => {
      navigator.serviceWorker.getRegistration()
        .then((registration) => registration?.update())
        .catch(() => undefined);
    };
    checkForUpdate();
    const interval = window.setInterval(checkForUpdate, UPDATE_CHECK_MS);
    const onVisibility = () => { if (document.visibilityState === 'visible') checkForUpdate(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', checkForUpdate);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', checkForUpdate);
    };
  }, []);

  if (!updating) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
      <div className="flex items-center gap-2 rounded-full border border-white/15 bg-slate-900/95 px-4 py-2 text-sm text-white shadow-2xl">
        <Loader2 className="h-4 w-4 animate-spin text-sky-300" />
        Hay una versión nueva de Calili — actualizando…
      </div>
    </div>
  );
}
