# 🚀 Calili - Guía de Despliegue

## 📋 Checklist Pre-Despliegue

### 1. ✅ Configurar Supabase

- [ ] Crear proyecto en Supabase
- [ ] Ejecutar SQL de migraciones (ver README.md)
- [ ] Copiar URL y ANON_KEY
- [ ] Habilitar Auth providers (opcional: Google, GitHub)

### 2. ✅ Configurar API GPT

- [ ] Obtener API key de tu proveedor
- [ ] Verificar que soporta:
  - `/v1/chat/completions` (chat)
  - `/v1/images/generations` (DALL-E)

### 3. ✅ Variables de Entorno

Crea `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
GPT_API_URL=https://api.openai.com/v1/chat/completions
GPT_API_KEY=sk-xxx
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. ✅ Generar Iconos PWA

Sigue las instrucciones en `GENERAR-ICONOS.md` para crear todos los iconos requeridos.

---

## 🌐 Deploy en Vercel

### Opción A: Desde GitHub (Recomendado)

1. **Push a GitHub:**

```bash
git init
git add .
git commit -m "Initial commit - Calili"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/calili.git
git push -u origin main
```

2. **Conectar Vercel:**

- Ve a https://vercel.com
- Click **"Import Project"**
- Selecciona tu repositorio GitHub
- Framework preset: **Next.js** (auto-detectado)

3. **Configurar Variables de Entorno:**

En Vercel Dashboard → **Settings** → **Environment Variables**:

```
NEXT_PUBLIC_SUPABASE_URL = https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJxxx...
GPT_API_URL = https://api.openai.com/v1/chat/completions
GPT_API_KEY = sk-xxx
NEXT_PUBLIC_APP_URL = https://calili.vercel.app
```

4. **Deploy:**

- Click **"Deploy"**
- Espera 2-3 minutos
- ✅ Listo! URL: `https://calili.vercel.app`

### Opción B: Vercel CLI

```bash
npm i -g vercel
vercel login
vercel

# Configurar variables
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add GPT_API_URL
vercel env add GPT_API_KEY

# Deploy a producción
vercel --prod
```

---

## 📱 Configurar Dominio Custom

1. En Vercel Dashboard → **Settings** → **Domains**
2. Click **"Add"**
3. Ingresa tu dominio: `calili.tudominio.com`
4. Sigue las instrucciones DNS
5. Espera propagación (5-10 min)

---

## 🔒 Configurar HTTPS

Vercel provee HTTPS automático con certificado SSL gratuito (Let's Encrypt).

**No requiere configuración adicional.**

---

## 🧪 Testing Post-Deploy

### 1. Verificar PWA

En Chrome DevTools:
- **Application** → **Manifest** → Verificar que carga
- **Lighthouse** → Run PWA audit → Score >90

### 2. Probar instalación

**iOS:**
- Safari → Compartir → Agregar a inicio
- Abrir app → Verificar que funciona offline

**Android:**
- Chrome → Banner "Instalar app"
- Instalar → Verificar icono en pantalla

### 3. Funcionalidades

- [ ] Chat funciona (streaming)
- [ ] Generación de imágenes funciona
- [ ] Modo razonamiento funciona
- [ ] Voz funciona (síntesis)
- [ ] Historial persiste
- [ ] Modo oscuro/claro
- [ ] Sidebar responsive

---

## 📊 Monitoreo

### Vercel Analytics

Habilitar en Dashboard → **Analytics** (gratis hasta 2,500 eventos/mes)

### Logs en tiempo real

```bash
vercel logs --follow
```

---

## 🐛 Troubleshooting Deploy

### Error: "Module not found"

```bash
# Limpiar cache
rm -rf .next node_modules
npm install
npm run build
```

### Error: Variables de entorno no funcionan

- En Vercel: Redeploy para aplicar cambios
- Verificar prefijo `NEXT_PUBLIC_` en variables del cliente

### PWA no funciona en producción

- Verificar que `next.config.js` tiene `withPWA`
- Verificar que `manifest.json` es accesible: `https://tu-url.com/manifest.json`
- Forzar HTTPS (HTTP no permite PWA)

---

## 🔄 CI/CD Automático

Ya incluido en `.github/workflows/deploy.yml`

**Cada push a `main` despliega automáticamente.**

Configurar secrets en GitHub:
- **Settings** → **Secrets** → **Actions**
- Agregar:
  - `VERCEL_TOKEN`
  - `VERCEL_ORG_ID`
  - `VERCEL_PROJECT_ID`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `GPT_API_URL`
  - `GPT_API_KEY`

---

## 💰 Costos Estimados

| Servicio | Plan | Costo |
|----------|------|-------|
| **Vercel** | Hobby | $0 (hasta 100GB bandwidth) |
| **Supabase** | Free | $0 (hasta 500MB DB) |
| **OpenAI API** | Pay-as-you-go | ~$0.002/request GPT-4 |
| **DALL-E 3** | Pay-as-you-go | ~$0.04/imagen |

**Total mensual:** $0 + costos de API (depende de uso)

---

## 📈 Escalabilidad

### Gratis → Pro

Si superas límites gratuitos:

1. **Vercel Pro:** $20/mes (500GB bandwidth, analytics avanzado)
2. **Supabase Pro:** $25/mes (8GB DB, backups diarios)
3. **OpenAI:** Escala según uso (sin límite)

---

## ✅ Checklist Final

- [ ] Deploy exitoso en Vercel
- [ ] Variables de entorno configuradas
- [ ] Supabase conectado
- [ ] API GPT funcionando
- [ ] PWA instalable en iOS
- [ ] PWA instalable en Android
- [ ] HTTPS habilitado
- [ ] Dominio custom (opcional)
- [ ] Analytics habilitado
- [ ] CI/CD configurado

---

**¡Listo! Calili está en producción.** 🎉

URL: https://calili.vercel.app
