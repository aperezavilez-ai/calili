import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Cliente de Supabase para el navegador. Usa SOLO la clave anon pública;
// la seguridad la dan las políticas RLS del proyecto (cada usuario solo
// accede a sus propias conversaciones). La service_role nunca va aquí.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null;
