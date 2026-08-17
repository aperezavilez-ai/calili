# 🤖 Calili - Tu Asistente AI Personal

![Calili Banner](https://via.placeholder.com/1200x400/343541/FFFFFF?text=Calili+AI)

Clon completo de ChatGPT como **PWA** instalable en iOS y Android. Incluye chat, generación de imágenes con DALL-E, razonamiento profundo y síntesis de voz.

---

## ✨ Características

### 💬 Chat Inteligente
- Conversaciones ilimitadas con historial
- Streaming en tiempo real (respuestas fluidas)
- Markdown y resaltado de código
- Editar y eliminar conversaciones

### 🎨 Generación de Imágenes
- DALL-E 3 integrado
- Múltiples tamaños: 1024x1024, 1792x1024, 1024x1792
- Calidad HD disponible
- Visualización inline en el chat

### 🧠 Modo Razonamiento
- Análisis paso a paso
- Explicación del proceso de pensamiento
- Ideal para problemas complejos

### 🔊 Síntesis de Voz
- Lectura automática de respuestas
- Voces masculina y femenina
- Soporte en español

### 📱 PWA (Progressive Web App)
- **Instalable en iOS y Android**
- Funciona offline
- Icono en pantalla de inicio
- Sin App Store / Play Store

---

## 🚀 Instalación

### 1. Clonar e instalar dependencias

```bash
cd "D:\PROGRAMAS IA\CALILI"
npm install
```

### 2. Configurar variables de entorno

Copia `.env.example` a `.env` y configura:

```env
# Supabase (Tu instancia dedicada)
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key

# API GPT (Tu proveedor)
GPT_API_URL=https://api.openai.com/v1/chat/completions
GPT_API_KEY=sk-tu-key-aqui
GPT_MODEL=gpt-5.5

# PWA
NEXT_PUBLIC_APP_URL=https://calili.vercel.app
```

### 3. Crear base de datos en Supabase

Ejecuta este SQL en tu Supabase Dashboard:

```sql
-- Tabla de conversaciones
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de mensajes
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_conversations_user ON conversations(user_id, updated_at DESC);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at ASC);

-- RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own conversations"
  ON conversations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can CRUD messages in own conversations"
  ON messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = auth.uid()
    )
  );
```

### 4. Ejecutar en desarrollo

```bash
npm run dev
```

Abre http://localhost:3000

---

## 📱 Instalar como PWA

### iOS (Safari):
1. Abrir Calili en Safari
2. Tap en icono **Compartir** (⬆️)
3. **"Agregar a pantalla de inicio"**
4. ✅ Listo! Abre como app nativa

### Android (Chrome):
1. Abrir Calili en Chrome
2. Banner automático **"Instalar app"**
3. Tap **"Instalar"**
4. ✅ Listo! Icono en pantalla de inicio

---

## 🌐 Deploy en Vercel

### 1. Push a GitHub

```bash
git init
git add .
git commit -m "Initial commit - Calili AI"
git branch -M main
git remote add origin https://github.com/TU_USER/calili.git
git push -u origin main
```

### 2. Conectar Vercel

1. Ve a [vercel.com](https://vercel.com)
2. **Import Project** → Selecciona tu repo GitHub
3. Configura variables de entorno:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `GPT_API_URL`
   - `GPT_API_KEY`
4. **Deploy**

### 3. Configurar dominio

En Vercel Dashboard:
- **Settings** → **Domains**
- Agregar `calili.vercel.app` o tu dominio custom

---

## 🛠️ Stack Tecnológico

| Tecnología | Propósito |
|-----------|-----------|
| **Next.js 14** | Framework React con App Router |
| **TypeScript** | Type safety |
| **Tailwind CSS** | Estilos modernos |
| **Zustand** | State management |
| **Supabase** | Auth + Base de datos |
| **next-pwa** | Soporte PWA |
| **react-markdown** | Renderizado Markdown |
| **react-syntax-highlighter** | Código con sintaxis |

---

## 📂 Estructura del Proyecto

```
CALILI/
├── public/
│   ├── manifest.json          # PWA config
│   ├── icon-*.png             # Iconos PWA
│   └── robots.txt
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── chat/          # Endpoint de chat
│   │   │   └── image/         # Endpoint de imágenes
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── ChatInterface.tsx  # Componente principal
│   │   ├── Sidebar.tsx        # Historial
│   │   ├── MessageList.tsx    # Lista de mensajes
│   │   └── InputBox.tsx       # Input con modos
│   ├── lib/
│   │   ├── supabase.ts        # Cliente Supabase
│   │   ├── gpt-client.ts      # Cliente GPT
│   │   ├── image-client.ts    # Cliente imágenes
│   │   └── voice-service.ts   # Síntesis de voz
│   └── store/
│       ├── chat-store.ts      # Estado de conversaciones
│       └── settings-store.ts  # Configuración
├── .env.example
├── project-infra.json         # Aislamiento Supabase
├── next.config.js             # Config PWA
└── package.json
```

---

## 🎨 Personalización

### Cambiar colores del tema

Edita `tailwind.config.js`:

```javascript
colors: {
  'chat-bg': '#343541',      // Fondo principal
  'chat-input': '#40414F',   // Input/mensajes
  'chat-sidebar': '#202123', // Sidebar
  'chat-hover': '#2A2B32',   // Hover
}
```

### Cambiar nombre y logo

1. **Nombre:** Edita `public/manifest.json`
2. **Iconos:** Reemplaza archivos `public/icon-*.png`
3. **Metadata:** Edita `src/app/layout.tsx`

---

## 🔐 Seguridad

- ✅ RLS habilitado en Supabase
- ✅ API keys en variables de entorno (nunca en código)
- ✅ Instancia Supabase dedicada (no compartida)
- ✅ HTTPS obligatorio en producción

---

## 📊 Roadmap

- [ ] Autenticación con Google/GitHub
- [ ] Sincronización en la nube (Supabase)
- [ ] Compartir conversaciones públicas
- [ ] Exportar chats (PDF, JSON)
- [ ] Modo offline completo
- [ ] Notificaciones push
- [ ] Búsqueda en historial

---

## 🐛 Troubleshooting

### Error: "Cannot find module 'next-pwa'"

```bash
npm install next-pwa --save
```

### Error: Variables de entorno no detectadas

Asegúrate de tener `.env` (sin `.example`) y reinicia el servidor.

### PWA no se instala en iOS

Verifica que:
1. Estás usando **Safari** (no Chrome)
2. El sitio es **HTTPS** (localhost funciona)
3. Tienes `manifest.json` válido

---

## 📄 Licencia

MIT License - Úsalo libremente para proyectos personales o comerciales.

---

## 🤝 Contribuciones

Pull requests bienvenidos. Para cambios grandes, abre un issue primero.

---

## 📧 Soporte

¿Problemas o preguntas? Abre un issue en GitHub.

---

**Hecho con ❤️ por [Tu Nombre]**

🌟 Si te gusta el proyecto, dale una estrella en GitHub!
