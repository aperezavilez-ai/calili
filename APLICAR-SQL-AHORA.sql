-- EJECUTAR ESTO EN: https://supabase.gafcore.com/db/ → SQL Editor

-- ============================================================================
-- CALILI - Schema separado en GafCore
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS calili;

-- Conversations
CREATE TABLE IF NOT EXISTS calili.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages
CREATE TABLE IF NOT EXISTS calili.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES calili.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_calili_conversations_user ON calili.conversations(user_id, updated_at DESC);
CREATE INDEX idx_calili_messages_conversation ON calili.messages(conversation_id, created_at ASC);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION calili.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_calili_conversations_updated_at
  BEFORE UPDATE ON calili.conversations
  FOR EACH ROW
  EXECUTE FUNCTION calili.update_updated_at_column();

-- RLS
ALTER TABLE calili.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE calili.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users CRUD own conversations"
  ON calili.conversations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users CRUD messages in own conversations"
  ON calili.messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM calili.conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = auth.uid()
    )
  );

-- Grants
GRANT USAGE ON SCHEMA calili TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA calili TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA calili TO authenticated;

SELECT '✅ Calili schema creado correctamente' AS status;
