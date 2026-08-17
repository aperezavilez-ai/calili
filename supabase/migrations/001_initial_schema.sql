-- ============================================================================
-- CALILI - Migraciones SQL para Supabase
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLA: conversations (Conversaciones de chat)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversations_user ON conversations(user_id, updated_at DESC);

COMMENT ON TABLE conversations IS 'Historial de conversaciones de cada usuario';

-- ----------------------------------------------------------------------------
-- 2. TABLA: messages (Mensajes dentro de conversaciones)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at ASC);

COMMENT ON TABLE messages IS 'Mensajes de chat (usuario, asistente, sistema)';

-- ----------------------------------------------------------------------------
-- 3. TRIGGER: updated_at automático
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Usuarios pueden CRUD sus propias conversaciones
CREATE POLICY "Users can CRUD own conversations"
  ON conversations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Usuarios pueden CRUD mensajes en sus propias conversaciones
CREATE POLICY "Users can CRUD messages in own conversations"
  ON messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 5. GRANTS (Permisos)
-- ----------------------------------------------------------------------------
GRANT ALL ON conversations TO authenticated;
GRANT ALL ON messages TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. FUNCIONES ÚTILES
-- ----------------------------------------------------------------------------

-- Obtener estadísticas de usuario
CREATE OR REPLACE FUNCTION get_user_stats(p_user_id UUID)
RETURNS TABLE (
  total_conversations INTEGER,
  total_messages INTEGER,
  last_activity TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(DISTINCT c.id)::INTEGER as total_conversations,
    COUNT(m.id)::INTEGER as total_messages,
    MAX(c.updated_at) as last_activity
  FROM conversations c
  LEFT JOIN messages m ON m.conversation_id = c.id
  WHERE c.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_user_stats(UUID) IS 'Obtiene estadísticas de uso de un usuario';

-- Buscar conversaciones por texto
CREATE OR REPLACE FUNCTION search_conversations(
  p_user_id UUID,
  p_query TEXT,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  conversation_id UUID,
  title TEXT,
  relevance FLOAT,
  last_message TEXT,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id as conversation_id,
    c.title,
    ts_rank(
      to_tsvector('spanish', c.title || ' ' || COALESCE(string_agg(m.content, ' '), '')),
      plainto_tsquery('spanish', p_query)
    ) as relevance,
    (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
    c.updated_at
  FROM conversations c
  LEFT JOIN messages m ON m.conversation_id = c.id
  WHERE c.user_id = p_user_id
  GROUP BY c.id, c.title, c.updated_at
  HAVING ts_rank(
    to_tsvector('spanish', c.title || ' ' || COALESCE(string_agg(m.content, ' '), '')),
    plainto_tsquery('spanish', p_query)
  ) > 0
  ORDER BY relevance DESC, c.updated_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION search_conversations(UUID, TEXT, INTEGER) IS 'Búsqueda full-text en conversaciones';

-- ----------------------------------------------------------------------------
-- ✅ MIGRACIÓN COMPLETADA
-- ----------------------------------------------------------------------------

-- Verificar tablas creadas
DO $$
BEGIN
  RAISE NOTICE '✅ Calili - Base de datos configurada correctamente';
  RAISE NOTICE 'Tablas: conversations, messages';
  RAISE NOTICE 'Funciones: get_user_stats(), search_conversations()';
END $$;
