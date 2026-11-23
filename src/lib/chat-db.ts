import { supabase } from '@/lib/supabase';
import type { Conversation, Message } from '@/store/chat-store';

// Persistencia de Calili en Supabase (tablas conversations/messages de la
// migración 002, con RLS por usuario). Todas las funciones son seguras de
// llamar sin sesión: si Supabase no está configurado, no hacen nada.

function db() {
  if (!supabase) throw new Error('Supabase no está configurado');
  return supabase;
}

export async function fetchConversations(userId: string): Promise<Conversation[]> {
  const client = db();
  const { data: convs, error } = await client
    .from('conversations')
    .select('id, title, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  if (!convs || convs.length === 0) return [];

  const ids = convs.map((c) => c.id);
  const { data: msgs, error: msgError } = await client
    .from('messages')
    .select('id, conversation_id, role, content, created_at')
    .in('conversation_id', ids)
    .order('created_at', { ascending: true });
  if (msgError) throw msgError;

  const messagesByConversation = new Map<string, Message[]>();
  for (const m of msgs ?? []) {
    const list = messagesByConversation.get(m.conversation_id) ?? [];
    list.push({
      id: m.id,
      role: m.role as Message['role'],
      content: m.content,
      timestamp: new Date(m.created_at).getTime(),
    });
    messagesByConversation.set(m.conversation_id, list);
  }

  return convs.map((c) => ({
    id: c.id,
    title: c.title,
    messages: messagesByConversation.get(c.id) ?? [],
    createdAt: new Date(c.created_at).getTime(),
    updatedAt: new Date(c.updated_at).getTime(),
  }));
}

export async function insertConversation(userId: string, conversation: Conversation): Promise<void> {
  const client = db();
  const { error } = await client.from('conversations').insert({
    id: conversation.id,
    user_id: userId,
    title: conversation.title,
    created_at: new Date(conversation.createdAt).toISOString(),
    updated_at: new Date(conversation.updatedAt).toISOString(),
  });
  if (error) throw error;
}

export async function insertMessage(conversationId: string, message: Message): Promise<void> {
  const client = db();
  const { error } = await client.from('messages').insert({
    id: message.id,
    conversation_id: conversationId,
    role: message.role,
    content: message.content,
    created_at: new Date(message.timestamp).toISOString(),
  });
  if (error) throw error;
  // Refresca updated_at de la conversación (el trigger hace el resto).
  await client
    .from('conversations')
    .update({ updated_at: new Date(message.timestamp).toISOString() })
    .eq('id', conversationId);
}

export async function updateConversationTitleDb(id: string, title: string): Promise<void> {
  const client = db();
  const { error } = await client.from('conversations').update({ title }).eq('id', id);
  if (error) throw error;
}

export async function deleteConversationDb(id: string): Promise<void> {
  const client = db();
  const { error } = await client.from('conversations').delete().eq('id', id);
  if (error) throw error;
}

// Sube una conversación local completa (conversación + mensajes). Se usa
// una sola vez, al primer inicio de sesión, para no perder el historial
// que el usuario ya tenía en el navegador.
export async function uploadLocalConversation(userId: string, conversation: Conversation): Promise<void> {
  await insertConversation(userId, conversation);
  for (const message of conversation.messages) {
    await insertMessage(conversation.id, message);
  }
}

// --- Memoria de largo plazo (migración 003) -------------------------------

export async function fetchMemoryFactsDb(userId: string): Promise<string[]> {
  const client = db();
  const { data, error } = await client
    .from('memory_facts')
    .select('fact')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => String((row as { fact: string }).fact));
}

export async function insertMemoryFactDb(userId: string, fact: string): Promise<void> {
  const client = db();
  const { error } = await client.from('memory_facts').insert({ user_id: userId, fact });
  if (error) throw error;
}

export async function deleteMemoryFactDb(userId: string, fact: string): Promise<void> {
  const client = db();
  const { error } = await client.from('memory_facts').delete().eq('user_id', userId).eq('fact', fact);
  if (error) throw error;
}
