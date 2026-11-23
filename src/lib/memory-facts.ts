import { fetchMemoryFactsDb, insertMemoryFactDb, deleteMemoryFactDb } from '@/lib/chat-db';
import { isSupabaseConfigured } from '@/lib/supabase';

// Memoria de largo plazo del usuario (cliente): une la copia local
// (localStorage, funciona sin cuenta) con Supabase (tabla memory_facts,
// migración 003) cuando hay sesión. Si la tabla aún no existe, la copia
// local sostiene la memoria y nada se pierde.

const MAX_FACTS = 60;

// La copia local va con el nombre del usuario: antes la clave era una
// sola para todo el navegador y la siguiente cuenta que entraba heredaba
// los hechos de la anterior (fuga entre cuentas en el mismo equipo).
function localKey(userId: string | null): string {
  return `calili-memory-facts:${userId ?? 'anon'}`;
}

function normalize(fact: string): string {
  return fact.trim().replace(/\s+/g, ' ');
}

function sameFact(a: string, b: string): boolean {
  return normalize(a).toLowerCase() === normalize(b).toLowerCase();
}

export function loadLocalFacts(userId: string | null = null): string[] {
  try {
    const raw = window.localStorage.getItem(localKey(userId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === 'string') : [];
  } catch {
    return [];
  }
}

function saveLocalFacts(facts: string[], userId: string | null = null) {
  try {
    window.localStorage.setItem(localKey(userId), JSON.stringify(facts.slice(-MAX_FACTS)));
  } catch { /* almacenamiento lleno o bloqueado */ }
}

export async function loadMemoryFacts(userId: string | null): Promise<string[]> {
  const local = loadLocalFacts(userId);
  if (!userId || !isSupabaseConfigured) return local;
  try {
    const remote = await fetchMemoryFactsDb(userId);
    const merged = [...remote];
    for (const fact of local) {
      if (!merged.some((f) => sameFact(f, fact))) merged.push(fact);
    }
    saveLocalFacts(merged, userId);
    return merged.slice(-MAX_FACTS);
  } catch {
    return local;
  }
}

export async function saveMemoryFact(userId: string | null, rawFact: string): Promise<string[]> {
  const fact = normalize(rawFact);
  const facts = loadLocalFacts(userId);
  if (fact && !facts.some((f) => sameFact(f, fact))) {
    facts.push(fact);
    saveLocalFacts(facts, userId);
    if (userId && isSupabaseConfigured) {
      try { await insertMemoryFactDb(userId, fact); } catch { /* queda la copia local */ }
    }
  }
  return loadLocalFacts(userId);
}

export async function removeMemoryFact(userId: string | null, rawFact: string): Promise<string[]> {
  const target = normalize(rawFact).toLowerCase();
  const facts = loadLocalFacts(userId);
  const hit = facts.find((f) => sameFact(f, rawFact))
    ?? facts.find((f) => f.toLowerCase().includes(target) || target.includes(f.toLowerCase()));
  if (hit) {
    saveLocalFacts(facts.filter((f) => f !== hit), userId);
    if (userId && isSupabaseConfigured) {
      try { await deleteMemoryFactDb(userId, hit); } catch { /* queda fuera de la copia local */ }
    }
  }
  return loadLocalFacts(userId);
}
