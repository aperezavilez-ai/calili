# CALILI — Reconstrucción desde cero (sobre el mismo proyecto)

## Fase 1 — Núcleo con motor NEXUS (esta entrega)

### Eliminado (no servía)
- `src/lib/gpt-client.ts` — cliente atado a proveedores ajenos (ME AI / APICredits) con IDs cableados.
- `src/lib/image-client.ts` y `src/app/api/image/route.ts` — generación de imágenes contra un endpoint GPT inexistente. Vuelve en Fase 2 con un proveedor de imágenes real.
- `src/app/api/search/route.ts` — "búsqueda web" con DuckDuckGo Instant Answers (no es búsqueda real). Vuelve en Fase 2 con búsqueda real y citas.
- `src/lib/supabase.ts` — cliente declarado y nunca usado.
- En el cliente: la rama de imágenes, el bloque de búsqueda y el envío de fotos al chat (el modelo actual es de texto; la visión llega en Fase 2).

### Nuevo
- `src/lib/nexus-gateway.ts` — pasarela única hacia NEXUS. Proveedores por entorno, sin nada cableado:
  - **Groq (producción):** `GROQ_API_KEY` + `NEXUS_MODEL=openai/gpt-oss-120b`.
  - **Local (desarrollo/respaldo):** `NEXUS_LOCAL_URL` (Ollama/LM Studio) + `NEXUS_LOCAL_MODEL`.
  - Si el proveedor primario falla antes del primer token (o tarda >20 s en arrancar), cae al siguiente.
- `src/app/api/chat/route.ts` — reescrito: validación, historial compactado (40 mensajes, contexto 131K del modelo), streaming SSE con el mismo formato que ya consume la interfaz, errores claros en español.
- `scripts/smoke-nexus.mjs` — prueba del motor en tu máquina: `node scripts/smoke-nexus.mjs`.
- `.env.example` — nuevo formato (ver ese archivo). La clave va SOLO en `.env.local` y en Vercel.

### Se conserva
- Interfaz (Sidebar, MessageList, InputBox), store de conversaciones local, voz del navegador, rutas `/api/files` (extrae texto de PDF/DOCX/TXT) y `/api/export` (MD/PDF/DOCX), PWA e iconos, infra GAFCORE (esquema `calili`).

### Verificación hecha por Lu (en su máquina virtual)
- `npm run build` — PASÓ: rutas finales `/`, `/api/chat`, `/api/export`, `/api/files`.
- Prueba extremo a extremo con un servidor local simulado compatible con OpenAI: el chat transmite la respuesta en streaming (`Soy Calili, tu asistente virtual. NEXUS responde.`) y el cuerpo enviado lleva el modelo configurado (`nexus-test`).
- Sin clave configurada, `/api/chat` responde el error declarado de configuración en español (no un fallo mudo). Mensajes inválidos → 400.
- Nota: en la VM de Lu el `npm install` necesitó `--no-bin-links` por un error de permisos del sistema; en Windows el `npm install` normal debe funcionar.

### Juicio en vivo de Luis (pendiente)
1. Poner una clave Groq vigente en `.env.local` (la de la captura quedó revocada).
2. `node scripts/smoke-nexus.mjs` → debe imprimir SMOKE OK con una frase del modelo.
3. `npm run dev` → abrir Calili, enviar un mensaje y ver la respuesta en streaming.

## Fases siguientes
- **Fase 2:** auth real + conversaciones en Supabase (esquema calili), búsqueda web real con citas, imágenes con proveedor real, visión.
- **Fase 3:** memoria de largo plazo, proyectos/asistentes, artefactos y ejecución de código.
- **Fase 4:** despliegue en Vercel con `GROQ_API_KEY` en variables del proyecto y aceptación integral en vivo.
