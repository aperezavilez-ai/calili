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

## Fase 2 — Cuenta real, historial en la nube, tablas y dictado (esta entrega)

### Nuevo
- `src/lib/supabase.ts` + `src/lib/chat-db.ts`: cliente Supabase (solo clave anon; la seguridad la da el RLS de la migración 002) y persistencia de conversaciones/mensajes. Con sesión activa, cada alta/baja/cambio del store se sincroniza; el respaldo local (localStorage) sigue existiendo para modo sin conexión.
- `src/components/AuthScreen.tsx` + compuerta en `ChatInterface`: si Supabase está configurado y no hay sesión, Calili pide correo/contraseña (login y registro). Al primer ingreso, el historial local se sube a la cuenta para no perderlo. En el Sidebar se ve el correo y el botón Salir (cerrar sesión limpia la vista local).
- Si las variables `NEXT_PUBLIC_SUPABASE_*` no están, Calili arranca en **modo local** (como la Fase 1): así el entorno de desarrollo sin claves nunca se rompe.
- `src/lib/markdown-fix.ts`: reparador de tablas Markdown (causa raíz del render roto de la captura de Luis: encabezados pegados al párrafo y delimitadores pegados a las filas). Se aplica al render de cada mensaje del asistente. Probado con los patrones exactos de la captura (4 casos PASS).
- `src/app/api/transcribe/route.ts` + micrófono nuevo en `InputBox`: dictado con **Whisper de Groq** (`whisper-large-v3-turbo`, español) vía MediaRecorder. Fuera `webkitSpeechRecognition`, que transcribía enredado.

### Pasos de Luis para esta fase
1. Supabase → **Authentication → Providers → Email**: desactivar **Confirm email** (app personal: entras directo al registrarte, sin esperar correo).
2. Variables en `.env.local` y en Vercel (Production) + Redeploy: `NEXT_PUBLIC_SUPABASE_URL=https://zspoeuvmreqyxahdfkyh.supabase.co` y `NEXT_PUBLIC_SUPABASE_ANON_KEY=` (la anon public de Settings → API).
3. Aplicar el paquete, commit y push como la Fase 1.

### Verificación de Lu
- Build completo (ver nota de entrega) y prueba extremo a extremo de `/api/transcribe` contra un servidor simulado de Groq: el audio llega, Whisper responde y la ruta devuelve el texto.
- La persistencia contra el Supabase real se juzga en vivo (login de Luis → conversar → cerrar sesión → entrar y ver el historial): Lu no tiene la clave anon y no debe tenerla en el chat.

### Lo que sigue (Fase 3)
- Búsqueda web real con citas (requiere una cuenta gratuita de búsqueda, p. ej. Tavily: una clave más para Luis).
- Visión con modelo multimodal de Groq y generación de imágenes con proveedor real.
- Memoria de largo plazo y proyectos/asistentes.

## Fase 3 — Herramientas reales y disciplina de estilo (esta entrega)

Motivo (juicio de Luis, 2026-11-23): las respuestas salían de miles de palabras y el modelo fingía capacidades (ofrecía /imagine y enlaces a imágenes inexistentes). Causas: no había prompt de sistema con disciplina de estilo y no existía ninguna herramienta real.

### Nuevo
- `src/lib/system-prompt.ts`: prompt único con estilo obligatorio (directo, proporcional a lo pedido, sin guías no pedidas, cierre en una línea) y honestidad de capacidades: el modelo solo anuncia las herramientas conectadas en el servidor.
- **Herramientas (function calling, Groq)** en `src/lib/tools.ts` + pasada de herramientas en `/api/chat` (si falla, cae al streaming normal: nunca deja sin respuesta):
  - `crear_archivo` (`src/lib/file-generator.ts`): Word .docx, Excel .xlsx, PDF, CSV, MD, TXT reales. El cliente recibe el archivo por SSE y muestra **tarjeta de descarga verde** sobre la caja de texto. Sustituye al viejo flujo que exportaba la respuesta en .md por heurística (eliminado de ChatInterface).
  - `buscar_web`: Tavily con citas; solo se anuncia si existe `TAVILY_API_KEY`.
  - `leer_repositorio`: GitHub público (descripción, README, estructura) sin clave.
- **Visión**: las imágenes adjuntas ya no se descartan; van como `image_url` (base64) al modelo `meta-llama/llama-4-scout-17b-16e-instruct` de Groq (misma clave) y la respuesta llega en streaming. Los documentos (PDF/DOCX/TXT) siguen por `/api/files`.
- `markdown-fix.ts` endurecido: convierte los `<br>` literales en espacios y envuelve filas de tabla sin `|` inicial cuando las celdas coinciden — el patrón extremo de la captura de Luis queda reconstruido (5 casos PASS).
- La pasarela ahora honra `GROQ_BASE_URL` (pruebas) y expone `completeWithTools` y `streamVisionChat`.

### Verificación de Lu
- Build completo PASS. E2E contra Groq simulado: (A) «créame un Excel» → tool call → XLSX real de 6.539 bytes (ZIP válido, celdas Servicio/Precio/datos dentro) + confirmación en streaming; (B) pregunta simple → respuesta breve sin archivo espurio; (C) imagen adjunta → llega como image_url al modelo Scout y su análisis en streaming. Generadores DOCX (8.558 bytes) y PDF (%PDF-) verificados por separado; CSV exacto.
- `buscar_web` verificado por compuerta: sin `TAVILY_API_KEY` la herramienta ni se anuncia.

### Pasos de Luis para esta fase
1. (Opcional, activa la búsqueda) Cuenta gratuita en tavily.com → API key → variable **TAVILY_API_KEY** en Vercel (tipo Secret) y en `.env.local`.
2. Aplicar el paquete (acumulativo: incluye la Fase 2 si aún no se aplicó), `npm install`, commit y push.
3. Juicio en vivo: pregunta simple → respuesta corta; «créame un Excel de precios» → tarjeta de descarga y archivo que abre; adjuntar una foto → análisis de la imagen; pedir una tabla → tabla dibujada.

### Honestidad de alcance
- **Generación de imágenes: no incluida.** Groq no ofrece generación de imágenes; meterla exige otro proveedor con su clave. Calili ya no la finge: si la pides, lo dice y ofrece alternativas (p. ej. crear el archivo del diseño en Word/PDF).
- Memoria de largo plazo y proyectos/asistentes quedan para la Fase 4.

## v2.3.0 — Modo Voz (orbe)
- Botón de ondas junto al micrófono en InputBox abre el Modo Voz a pantalla completa: orbe de colores con movimiento (respira en reposo, late con el nivel de tu voz al escuchar, gira al pensar, brilla al hablar).
- Bucle conversacional manos libres: escucha (Whisper, corte automático tras 1,4 s de silencio) → responde NEXUS → habla → vuelve a escuchar. La conversación también queda escrita en el chat y se guarda igual.
- Voz de Calili: ruta /api/speak con la voz neural femenina es-MX Dalia (servicio de voz de Microsoft vía msedge-tts, sin clave ni costo). Si ese servicio fallara, la app cae automáticamente a la voz del navegador. Variable opcional CALILI_VOICE para cambiar la voz.
- La función normalizeCaliliResponse se movió a src/lib/response-policy.ts (compartida por chat y modo voz).

## v2.3.1 — Móvil: panel lateral e instalación
- CORREGIDO el panel que se abría y se cerraba solo en el celular: un efecto en ChatInterface dependía de isSidebarOpen y lo cerraba a los 500 ms de abrirlo en pantallas <768px. Ahora el panel solo arranca cerrado al cargar en móvil.
- Panel estilo ChatGPT: fondo oscuro táctil para cerrarlo, animación de deslizamiento, deslizar desde el borde izquierdo de la pantalla para abrirlo y deslizar hacia la izquierda sobre el panel para cerrarlo.
- Instalar en iPhone: el botón de descarga del panel ahora también aparece en iOS (antes dependía de beforeinstallprompt, que Apple no soporta) y muestra las instrucciones Compartir → Agregar a pantalla de inicio.

## v2.4.0 — Voz realista, orbe fluida, latencia y un solo micrófono
- Diagnóstico en vivo de Lu: /api/speak devolvía 502 «t.mask is not a function» (msedge-tts empaquetado por Next/Vercel) y la app caía a la voz del navegador (en la PC de Luis, masculina). Corrección: msedge-tts/ws quedan como paquetes externos del servidor (serverComponentsExternalPackages) para que corran sin empaquetar.
- /api/speak con doble motor y cabecera X-Voice-Engine: 1) Edge Dalia es-MX; 2) si falla, TTS de Google (femenina, verificado por Lu con MP3 real); 3) si todo falla, el cliente usa la voz del navegador filtrando SOLO voces femeninas (fuera Pablo/Jorge y demás masculinas).
- Latencia: el modo voz ya no pasa por la pasada de herramientas (streaming directo) y pide respuestas de 1-3 frases; Calili empieza a hablar con la primera frase mientras el resto aún se genera (frases en tubería con precarga de audio); el corte por silencio bajó a 1,0 s.
- Orbe nueva estilo ChatGPT: esfera azul fluida con masas de luz que derivan dentro, brillo especular y sombra interior (fuera el degradado cónico de rueda de color).
- Un solo icono de voz (como ChatGPT): fuera el botón de ondas y fuera el dictado suelto del InputBox; el micrófono abre el Modo Voz. Dentro del Modo Voz hay botón de micrófono que pausa (corta escucha y voz al instante) y reanuda con otro toque; la X cierra.

## v2.5.0 — Voz fluida e instalación intuitiva
- Juicio de Luis sobre v2.4.0: un micrófono OK, voz femenina OK, pero «sigue robótica, no fluida» y sin icono de instalación en el celular. Causas de la roboticidad: síntesis frase por frase (la prosodia se reinicia en cada corte y los motores podían mezclarse entre frases) y MP3 a 48 kbps.
- Voz: /api/speak v3 con tres motores en cadena y cabecera X-Voice-Engine — 1) OpenAI gpt-4o-mini-tts (voz shimmer, instrucciones de tono cálido) SOLO si existe OPENAI_API_KEY: es la clase de voz de ChatGPT; 2) Edge Dalia a 96 kbps en UNA sola pasada con ritmo 0.94; 3) Google. El cliente ahora habla en máximo 2 bloques (primera frase sola para arrancar rápido + el resto completo en una pasada).
- Instalación: banner «Instala Calili» dentro de la app (sobre la caja de texto) — en Android dispara el prompt nativo del navegador; en iOS muestra los pasos Compartir → Agregar a pantalla de inicio (Apple no permite icono de instalación en la barra de Safari, por eso nunca apareció). Descartable por 7 días; no aparece si la app ya está instalada. El botón del panel lateral se mantiene.

## v2.6.0 — Herramientas de imagen y análisis total de archivos (incluye v2.5.0)
- Nueva herramienta crear_imagen (JPG/PNG reales con vista previa y descarga en el chat): sin clave usa Pollinations (gratuito, verificado por Lu generando JPEGs reales); con OPENAI_API_KEY usa gpt-image-1 y además EDITA la imagen adjunta (recrear con cambios de verdad).
- Con imagen adjunta, la ruta primero deja que el modelo decida: si pides recrear/modificar, llama crear_imagen con usar_adjunta (la adjunta viaja por el servidor, no por los argumentos); si pides análisis, responde la visión como antes.
- Análisis de archivos completo: /api/files ahora también extrae Excel .xlsx (hojas y filas, verificado con un XLSX real), además de PDF, Word, CSV y texto; el selector de archivos acepta .xlsx.
- v2.5.0 incluida: voz en máximo 2 bloques con Edge Dalia 96 kbps (y OpenAI TTS si hay clave) + banner de instalación PWA en la app.
- Efectos auditivos de la orbe (lib/earcons.ts, WebAudio sin archivos): pop suave al empezar a escuchar, chime cálido de dos notas cuando Calili va a hablar, descenso al pausar, ascenso al reanudar y golpe grave suave en error. Volumen bajo por diseño.
- Gesto móvil corregido: deslizar desde el borde exacto invocaba el «atrás» del sistema y cerraba la PWA. Ahora el gesto de apertura nace fuera de la zona del sistema (28-140px) y hay un centinela de historial: un «atrás» accidental cierra el panel o se consume, sin salir de la app.

## v2.7.0 — Memoria de largo plazo (Fase 4, primera parte)
- Causa del «no me recordó»: Calili no tenía memoria entre conversaciones; cada chat nacía de cero.
- Herramientas recordar/olvidar: el modelo guarda hechos durables (nombre, negocio, preferencias) en el momento en que el usuario los dice, sin esperar a que se lo pidan. Los hechos viajan en cada mensaje (sección MEMORIA DEL USUARIO del prompt) y se usan con naturalidad.
- Persistencia doble: localStorage (funciona sin cuenta y sin migración) + tabla memory_facts en Supabase (migración 003, RLS por usuario) cuando hay sesión; ambas se fusionan sin duplicados. El guardado lo aplica el cliente al recibir el evento {memory} del SSE.
- El modo voz también recuerda: su pasada ligera incluye solo las herramientas de memoria (las pesadas siguen fuera por latencia).
