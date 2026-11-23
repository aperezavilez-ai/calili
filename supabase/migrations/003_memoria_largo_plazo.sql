-- Calili Fase 4 — Memoria de largo plazo (migración 003)
-- Hechos durables que Calili aprende del usuario ("soy Luis", "mi estudio
-- se llama...") y recuerda entre conversaciones. Una fila por hecho.
-- Idempotente: se puede correr varias veces sin romper nada.

create table if not exists public.memory_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  fact text not null,
  created_at timestamptz not null default now()
);

create index if not exists memory_facts_user_idx
  on public.memory_facts (user_id, created_at);

alter table public.memory_facts enable row level security;

drop policy if exists "memory_facts_select_own" on public.memory_facts;
create policy "memory_facts_select_own" on public.memory_facts
  for select using (auth.uid() = user_id);

drop policy if exists "memory_facts_insert_own" on public.memory_facts;
create policy "memory_facts_insert_own" on public.memory_facts
  for insert with check (auth.uid() = user_id);

drop policy if exists "memory_facts_delete_own" on public.memory_facts;
create policy "memory_facts_delete_own" on public.memory_facts
  for delete using (auth.uid() = user_id);
