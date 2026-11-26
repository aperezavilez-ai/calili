-- ============================================================================
-- CALILI — Esquema oficial (única migración recomendada)
-- Proyecto Supabase de Calili
--
-- Idempotente: se puede ejecutar varias veces sin romper nada.
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Conversaciones
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nueva conversación',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_conversations_user
  on public.conversations (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- 2. Mensajes
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_conversation
  on public.messages (conversation_id, created_at asc);

-- ---------------------------------------------------------------------------
-- 3. Trigger updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_conversations_updated_at on public.conversations;
create trigger trg_conversations_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Memoria de largo plazo
-- ---------------------------------------------------------------------------
create table if not exists public.memory_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fact text not null,
  created_at timestamptz not null default now()
);

create index if not exists memory_facts_user_idx
  on public.memory_facts (user_id, created_at);

-- ---------------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memory_facts enable row level security;

-- Conversaciones
drop policy if exists "conversations propias" on public.conversations;
create policy "conversations propias"
  on public.conversations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Mensajes
drop policy if exists "mensajes de conversaciones propias" on public.messages;
create policy "mensajes de conversaciones propias"
  on public.messages for all
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

-- Memoria
drop policy if exists "memory_facts_select_own" on public.memory_facts;
create policy "memory_facts_select_own"
  on public.memory_facts for select
  using (auth.uid() = user_id);

drop policy if exists "memory_facts_insert_own" on public.memory_facts;
create policy "memory_facts_insert_own"
  on public.memory_facts for insert
  with check (auth.uid() = user_id);

drop policy if exists "memory_facts_delete_own" on public.memory_facts;
create policy "memory_facts_delete_own"
  on public.memory_facts for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
grant all on public.conversations to authenticated;
grant all on public.messages to authenticated;
grant all on public.memory_facts to authenticated;

select '✅ Calili schema (public) aplicado correctamente' as status;
