import { supabase, isSupabaseConfigured } from '@/lib/supabase';

// fetch hacia las rutas /api de Calili con el token de sesion del usuario.
// Las rutas lo exigen cuando Supabase esta configurado: sin sesion valida
// no se gasta cuota de las claves del servidor.
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (isSupabaseConfigured && supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) headers.set('Authorization', `Bearer ${token}`);
    } catch { /* sin sesion: la ruta decidira */ }
  }
  return fetch(input, { ...init, headers });
}
