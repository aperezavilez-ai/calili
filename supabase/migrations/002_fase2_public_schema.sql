-- ============================================================================
-- CALILI Fase 2 — Esquema en el Supabase OFICIAL de Luis
-- Proyecto: zspoeuvmreqyxahdfkyh.supabase.co
-- Se corre UNA vez en el SQL Editor del proyecto. Es idempotente:
-- puede correrse de nuevo sin romper nada.
-- ============================================================================

-- Conversaciones de cada usuario
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nueva conversación',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_conversations_user
  on public.conversations(user_id, updated_at desc);

-- Mensajes de cada conversación
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_conversation
  on public.messages(conversation_id, created_at asc);

-- updated_at automático en conversations
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

-- Seguridad por fila: cada usuario solo ve y toca lo suyo
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "conversations propias" on public.conversations;
create policy "conversations propias"
  on public.conversations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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
