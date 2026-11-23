import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

// Candado de las rutas API: cuando Supabase esta configurado (produccion),
// toda llamada debe traer el token de sesion del usuario; sin token valido
// no se gasta ni un token de las claves del servidor. En desarrollo local
// puro (sin variables de Supabase) las rutas quedan abiertas, igual que la
// app, que en ese modo tampoco pide cuenta.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const apiAuthEnabled = Boolean(url && anonKey);

export async function requireApiUser(req: NextRequest): Promise<{ userId: string } | null> {
  if (!apiAuthEnabled) return { userId: 'local' };
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const client = createClient(url as string, anonKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id };
}
