import { fetchMemoryFactsDb, insertMemoryFactDb, deleteMemoryFactDb } from '@/lib/chat-db';
import { isSupabaseConfigured } from '@/lib/supabase';

// Memoria de largo plazo del usuario (cliente): une la copia local
// (localStorage, funciona sin cuenta) con Supabase (tabla memory_facts,
// migración 003) cuando hay sesión. Si la tabla aún no existe, la copia
// local sostiene la memoria y nada se pierde.

const LOCAL_KEY = 'calili-memory-facts';
const MAX_FACTS = 60;

function normalize(fact: string): string {
  return fact.trim().replace(/\s+/g, ' ');
}

function sameFact(a: string, b: string): boolean {
  return normalize(a).toLowerCase() === normalize(b).toLowerCase();
}

export function loadLocalFacts(): string[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === 'string') : [];
  } catch {
    return [];
  }
}

function saveLocalFacts(facts: string[]) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(facts.slice(-MAX_FACTS)));
  } catch { /* almacenamiento lleno o bloqueado */ }
}

export async function loadMemoryFacts(userId: string | null): Promise<string[]> {
  const local = loadLocalFacts();
  if (!userId || !isSupabaseConfigured) return local;
  try {
    const remote = await fetchMemoryFactsDb(userId);
    const merged = [...remote];
    for (const fact of local) {
      if (!merged.some((f) => sameFact(f, fact))) merged.push(fact);
    }
    saveLocalFacts(merged);
    return merged.slice(-MAX_FACTS);
  } catch {
    return local;
  }
}

export async function saveMemoryFact(userId: string | null, rawFact: string): Promise<string[]> {
  const fact = normalize(rawFact);
  const facts = loadLocalFacts();
  if (fact && !facts.some((f) => sameFact(f, fact))) {
    facts.push(fact);
    saveLocalFacts(facts);
    if (userId && isSupabaseConfigured) {
      try { await insertMemoryFactDb(userId, fact); } catch { /* queda la copia local */ }
    }
  }
  return loadLocalFacts();
}

export async function removeMemoryFact(userId: string | null, rawFact: string): Promise<string[]> {
  const target = normalize(rawFact).toLowerCase();
  const facts = loadLocalFacts();
  const hit = facts.find((f) => sameFact(f, rawFact))
    ?? facts.find((f) => f.toLowerCase().includes(target) || target.includes(f.toLowerCase()));
  if (hit) {
    saveLocalFacts(facts.filter((f) => f !== hit));
    if (userId && isSupabaseConfigured) {
      try { await deleteMemoryFactDb(userId, hit); } catch { /* queda fuera de la copia local */ }
    }
  }
  return loadLocalFacts();
}
