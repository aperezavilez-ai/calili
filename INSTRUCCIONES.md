# 📝 INSTRUCCIONES DE CONFIGURACIÓN - CALILI

## 🎯 Pasos para poner Calili en funcionamiento

### 1. ✅ Instalar dependencias (EN PROGRESO)

```bash
cd "D:\PROGRAMAS IA\CALILI"
npm install
```

**Estado:** Instalando en background...

---

### 2. 📋 Configurar tu Supabase

#### A. Crear proyecto en Supabase:
1. Ve a https://supabase.com
2. Click **"New Project"**
3. Nombre: `calili`
4. Elige región más cercana
5. Genera password fuerte

#### B. Ejecutar migración SQL:
1. En tu proyecto Supabase → **SQL Editor**
2. Click **"New query"**
3. Copia el contenido de: `supabase/migrations/001_initial_schema.sql`
4. Pega y ejecuta (**RUN**)
5. Verifica: Deberías ver mensaje "✅ Calili - Base de datos configurada correctamente"

#### C. Obtener credenciales:
- **Settings** → **API**
- Copia:
  - `Project URL` → NEXT_PUBLIC_SUPABASE_URL
  - `anon/public key` → NEXT_PUBLIC_SUPABASE_ANON_KEY

---

### 3. 🔑 Configurar tu API de GPT

Necesitas una API compatible con OpenAI:
- **OpenAI:** https://platform.openai.com/api-keys
- **Azure OpenAI:** https://azure.microsoft.com/en-us/products/ai-services/openai-service
- **Otro proveedor compatible**

Obtén:
- `API URL` (ej: `https://api.openai.com/v1/chat/completions`)
- `API KEY` (ej: `sk-proj-...`)

---

### 4. 📝 Crear archivo .env

Copia `.env.example` a `.env`:

```bash
cp .env.example .env
```

Edita `.env` con tus credenciales:

```env
# Supabase (Del paso 2)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# API GPT (Del paso 3)
GPT_API_URL=https://api.openai.com/v1/chat/completions
GPT_API_KEY=sk-proj-xxxxx

# App
NEXT_PUBLIC_APP_NAME=Calili
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

### 5. 🎨 Generar iconos PWA

**Opción rápida (placeholders):**

```bash
# Crear iconos temporales (Windows)
# Usa Paint 3D o cualquier editor de imágenes

# Tamaños requeridos en public/:
# - icon-72.png (72x72)
# - icon-96.png (96x96)
# - icon-128.png (128x128)
# - icon-144.png (144x144)
# - icon-152.png (152x152)
# - icon-192.png (192x192)
# - icon-384.png (384x384)
# - icon-512.png (512x512)
# - apple-touch-icon.png (180x180)
```

**Diseño sugerido:** Gradiente morado-rosa con letra "C"

**Referencia completa:** Ver `GENERAR-ICONOS.md`

---

### 6. 🚀 Ejecutar en desarrollo

```bash
npm run dev
```

Abre: http://localhost:3000

**Deberías ver:**
- ✅ Interfaz tipo ChatGPT
- ✅ Sidebar con historial
- ✅ 3 modos: Chat, Razonamiento, Imagen
- ✅ Input con botón enviar

---

### 7. ✅ Probar funcionalidades

#### Chat normal:
1. Escribe: "Hola, ¿qué puedes hacer?"
2. Debería responder con streaming

#### Modo razonamiento:
1. Click botón **"Razonamiento"**
2. Escribe: "¿Cuál es la raíz cuadrada de 144 y por qué?"
3. Debería mostrar proceso paso a paso

#### Generación de imágenes:
1. Click botón **"Imagen"**
2. Escribe: "Un gato astronauta en el espacio"
3. Debería generar imagen con DALL-E

---

### 8. 📱 Probar como PWA

#### Desarrollo (localhost):

**iOS Safari:**
1. Abre http://localhost:3000 en Safari
2. Compartir → Agregar a inicio
3. Abre como app

**Android Chrome:**
1. Abre http://localhost:3000 en Chrome
2. Menú → "Instalar app"
3. Acepta

---

### 9. 🌐 Deploy a producción

Cuando esté listo para producción, sigue: **DEPLOY.md**

---

## 🐛 Problemas comunes

### Error: "Cannot find module 'next-pwa'"

```bash
npm install next-pwa --save
```

### Error: "Supabase connection failed"

- Verifica `.env` tiene las credenciales correctas
- Verifica que ejecutaste la migración SQL
- Reinicia el servidor: `Ctrl+C` → `npm run dev`

### Error: "GPT API error 401"

- Verifica que `GPT_API_KEY` es correcta
- Verifica que tiene saldo/créditos en tu cuenta

### PWA no se instala

- En desarrollo, debe ser `localhost` o `HTTPS`
- Verifica que `manifest.json` es accesible: http://localhost:3000/manifest.json
- Verifica que tienes los iconos en `public/`

---

## 📊 Estructura de archivos creados

```
CALILI/
├── .env.example              ✅ Plantilla variables
├── .gitignore                ✅ Ignorar node_modules, .env
├── package.json              ✅ Dependencias
├── tsconfig.json             ✅ TypeScript config
├── tailwind.config.js        ✅ Estilos
├── next.config.js            ✅ PWA config
├── project-infra.json        ✅ Aislamiento Supabase
├── README.md                 ✅ Documentación completa
├── DEPLOY.md                 ✅ Guía de despliegue
├── GENERAR-ICONOS.md         ✅ Instrucciones iconos
├── public/
│   ├── manifest.json         ✅ PWA manifest
│   ├── robots.txt            ✅ SEO
│   └── browserconfig.xml     ✅ Windows tiles
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── chat/route.ts     ✅ Endpoint chat
│   │   │   └── image/route.ts    ✅ Endpoint imágenes
│   │   ├── layout.tsx            ✅ Layout principal
│   │   ├── page.tsx              ✅ Página home
│   │   └── globals.css           ✅ Estilos globales
│   ├── components/
│   │   ├── ChatInterface.tsx     ✅ Componente principal
│   │   ├── Sidebar.tsx           ✅ Historial sidebar
│   │   ├── MessageList.tsx       ✅ Lista mensajes
│   │   └── InputBox.tsx          ✅ Input con modos
│   ├── lib/
│   │   ├── supabase.ts           ✅ Cliente Supabase
│   │   ├── gpt-client.ts         ✅ Cliente GPT
│   │   ├── image-client.ts       ✅ Cliente imágenes
│   │   └── voice-service.ts      ✅ Síntesis voz
│   └── store/
│       ├── chat-store.ts         ✅ Estado conversaciones
│       └── settings-store.ts     ✅ Configuración
└── supabase/
    └── migrations/
        └── 001_initial_schema.sql ✅ Base de datos
```

---

## 🎉 ¡Listo!

Una vez completados los pasos 1-6, Calili estará funcionando localmente.

**Próximos pasos:**
1. Personalizar colores/estilos en `tailwind.config.js`
2. Generar iconos profesionales
3. Probar todas las funcionalidades
4. Deploy a Vercel (ver `DEPLOY.md`)

---

**¿Dudas?** Revisa `README.md` para más detalles.
