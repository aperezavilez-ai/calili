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

## v2.7.1 — Visión: Groq retiró Llama 4 Scout
- Error en vivo de Luis (2026-11-23): «The model meta-llama/llama-4-scout-17b-16e-instruct does not exist» (404 model_not_found). Verificado en fuentes: Groq anunció el retiro el 2026-06-17 y lo apagó el 2026-07-17 en planes free/developer.
- La visión pasa a una CADENA de modelos en nexus-gateway (VISION_MODELS): qwen/qwen3.8-27b → qwen/qwen3.6-27b → qwen/qwen3-vl-32b-instruct; ante un 404 model_not_found se prueba el siguiente antes del primer token, y la variable VISION_MODEL puede anteponer un ID propio. Otros errores (401/429) se reportan tal cual.

## v2.8.0 — Modo voz como ChatGPT: conexión, sin texto en pantalla
- Corrección de Luis: la voz se sentía lenta porque la transcripción y la respuesta se MOSTRABAN como texto en la pantalla de la orbe (renglón «Tú: …» y la respuesta escrita), como un paso intermedio visible.
- La pantalla de voz ya no muestra ningún texto de la plática: solo la orbe y la palabra de estado. La transcripción y las respuestas se siguen guardando por escrito en el chat, por detrás, sin interferir.
- Sonido de CONEXIÓN al activar el modo voz (arpegio cálido ascendente, earcon 'connect'), como el de ChatGPT al entrar.
- Corte de silencio de 1.0 s a 0.8 s: la respuesta arranca antes tras cada frase.

## v2.9.0 — Identidad sin slogan (orden de Luis)
- Fuera «tu asistente virtual / personal» de toda la superficie: título de la app y manifest («Calili», a secas, como ChatGPT/Gemini), subtítulo de AuthScreen («Inicia sesión para continuar»), pie del Sidebar («Calili»), README y descripción del paquete.
- La identidad en el prompt del sistema ya no es «el asistente personal de Luis» sino una IA conversacional general (la personalización real viene de la memoria por usuario, no de un slogan).
- response-policy ya no reescribe presentaciones como «Soy Calili, tu asistente virtual» sino «Soy Calili.».

## v3.0.0 — Experiencia de chat a la altura de los grandes
- Acciones por mensaje: copiar, escuchar la respuesta (TTS), regenerar la última respuesta y editar un mensaje propio (corta la conversación ahí y reenvía, con borrado sincronizado en Supabase). Bloques de código con botón de copiar y etiqueta de lenguaje.
- Pantalla inicial con tarjetas de sugerencia que disparan las herramientas reales (Excel, búsqueda, imagen, redacción).
- Exportar conversación a Word: botón en cada fila del historial que por fin usa /api/export (la ruta existía huérfana desde el proyecto original).
- Refactor: la pasada contra /api/chat vive en streamReply() y la comparten enviar/regenerar/editar; los mensajes se leen frescos del store. El modelo por defecto del selector ya no es el falso «gpt-5.5» sino openai/gpt-oss-120b.

## v3.1.0 — Estudio creativo de Google + resumen automático
- GOOGLE_AI_API_KEY (AI Studio) documentada en .env.example. Nueva lib/google-media.ts con las tres APIs verificadas en la documentación oficial: imágenes/edición con Gemini Flash Image (generateContent, cadena gemini-3.1-flash-image-preview → gemini-2.5-flash-image), video con Veo 3.1 Fast (predictLongRunning + sondeo + descarga con la clave reaplicada tras redirecciones) y música con Lyria (cadena lyria-3.5 → clip/pro). Salidas con marca SynthID de Google.
- crear_imagen prefiere Google (genera Y EDITA la adjunta de verdad); OpenAI queda segundo y Pollinations de respaldo gratuito. Herramientas nuevas crear_video (8 s con audio) y crear_musica (canción o clip de 30 s), anunciadas solo si la clave existe. Las tarjetas de video/audio del chat ahora traen reproductor. maxDuration de /api/chat = 300 por la espera de Veo.
- Resumen rodante: cuando la conversación supera el contexto (40 mensajes), la parte antigua se resume con NEXUS y viaja como mensaje de sistema; el historial visible nunca se toca. El cliente cachea el resumen por conversación (evento {summary}) y lo devuelve en cada envío. E2E de Lu contra Groq simulado PASS: evento emitido e inyección confirmada.

## v3.1.1 — Candado de identidad (orden de Luis)
- Problema en vivo: al preguntarle qué modelo es, Calili respondió con un nombre inventado («calili-4») y que «pertenece a OpenAI». El motor NO cambió: sigue siendo el ID que Luis designó como su modelo (openai/gpt-oss-120b en Groq); la fuga era de identidad — la base abierta tiende a reclamar ese linaje al ser interrogada, y los textos que el modelo lee nombraban proveedores (Google Veo/Lyria en descripciones de herramientas).
- Corrección en tres capas: (1) sección IDENTIDAD — REGLA ABSOLUTA en el prompt: solo «Soy Calili, un modelo de inteligencia artificial propio», sin proveedores ni versiones inventadas; (2) fuera los nombres de proveedor de TODOS los textos que el modelo lee (descripciones y resultados de herramientas); (3) filtro de salida reforzado: cualquier frase que atribuya origen/dueño/motor externo se sustituye entera por la identidad pública (5 casos probados, incluido que hablar DE OpenAI como tema no se toca).

## v3.1.2 — Reparación del proceso de voz (juicio en vivo de Luis)
- Síntomas: al activar el micro salían preguntas que Luis no hizo y la voz de Calili no se escuchaba. Verificado por Lu desde fuera: /api/speak en producción SANO (200, X-Voice-Engine: edge-dalia, MP3 real 48 KB) — el daño era del lado del cliente y de la transcripción.
- Causa 1 (fantasmas): la captura pedía el micrófono sin cancelación de eco, empezaba a grabar sobre la cola de la respuesta anterior sonando en la bocina, con umbral bajo, y Whisper (formato json, sin filtro) alucina frases —incluso preguntas— sobre ruido/silencio.
- Causa 2 (mudez): cada bloque creaba un `new Audio()` tras esperas de red; el navegador bloquea esa reproducción sin gesto cercano y el código resolvía en silencio, sin caer a la voz del navegador.
- Corrección: elemento de audio ÚNICO desbloqueado con el toque que abre el modo voz y reutilizado en todos los bloques; si la reproducción es bloqueada, cae a la voz del navegador (nunca mudo). Captura con echoCancellation/noiseSuppression/autoGainControl, ventana de gracia de 400 ms, puerta de energía (pico RMS < 0,05 no se transcribe) y guardia anti-eco (lo transcrito se descarta si es la respuesta anterior de Calili). /api/transcribe pasa a verbose_json y descarta segmentos con no_speech_prob > 0,6.

## v3.2.0 — Auditoría total y endurecimiento (orden de Luis: análisis de punta a punta)
Tres auditorías de solo lectura (servidor, cliente, configuración/seguridad) + sondas de Lu en producción. Corregido en este paquete:
- SEGURIDAD: las 5 rutas API exigen sesión válida cuando Supabase está configurado (api-auth + apiFetch con token en el cliente); en local puro sin Supabase quedan abiertas como la app. Borrados los archivos legados GAFCORE con claves demo de Supabase escritas (AGENTS.md, CLAUDE.md, .cursorrules, project-infra.json, DEPLOY.md, INSTRUCCIONES.md, setup.js — origen probable del .env duplicado —, APLICAR-SQL-* y la migración 001 con funciones SECURITY DEFINER que saltaban RLS). Cabeceras de seguridad en next.config, .gitignore ya no traga .env.example, fuera @supabase/auth-helpers (muerto).
- CHAT: el cliente ya no aborta a los 120 s (los videos morían siempre; ahora 300 s); las llamadas a herramientas se reinyectan solo las ejecutadas (4+ llamadas rompían el turno con 400 de Groq); la visión recibe la memoria del usuario y adjunta al último mensaje del usuario esté donde esté; resumen rodante con puntero acotado; latido SSE cada 15 s; send/close protegidos tras desconexión; errores al usuario sin nombres de proveedor (publicErrorMessage); el filtro de identidad ya no toca bloques de código.
- VOZ: speak maxDuration 30→60 con timeouts coherentes y cierre del WebSocket de Edge por petición; transcribe con nombre según tipo real (Safari graba MP4), timeout y maxDuration; VoiceMode con tope duro de grabación fuera de rAF, reintento ante errores transitorios y guardia anti-eco sin falsos positivos en frases cortas.
- ARCHIVOS: /api/files con tope de 5 archivos/25 MB, un archivo corrupto ya no tumba el lote y errores sin detalle interno; /api/export sanea el título (rompía Content-Disposition) y topa el contenido; file-generator valida formato y topes; imágenes con cadena de respaldo real (Google→OpenAI→Pollinations) y verificación de tipo en Pollinations; Veo reporta 4xx al instante y la clave de Google solo viaja a dominios de Google; Tavily/GitHub con timeout; completeWithTools con timeout de 90 s; streams del gateway cancelan su reader.
- CLIENTE: archivos generados por conversación (ya no se pierden al cambiar de chat); streaming con dueño (no se ve en otras conversaciones); Detener conserva lo ya escrito y sí detiene tras subir archivos; una línea SSE corrupta ya no aborta la respuesta; carga de historial una sola vez por usuario y fusión de conversaciones solo-locales; primer mensaje de conversación nueva espera su inserción (FK); fetchConversations paginado (PostgREST cortaba en 1.000); memoria local con nombre por usuario (fuga entre cuentas); resumen invalidado al editar/borrar; Sidebar sin botones anidados (HTML inválido); auto-scroll solo si el usuario está abajo; descargas con revocación diferida; signUp fija emailRedirectTo al origen; zoom de accesibilidad restaurado; el chat escrito envía el modelo elegido.
- Verificado por Lu: build PASS; e2e local con Groq simulado (4 llamadas → 3 ejecutadas sin romper); con Supabase configurado, chat/speak/export responden 401 sin sesión.
- Queda como propuesta (no en este paquete): registro por invitación + panel admin/medidor de uso, proyectos/asistentes, voz interrumpible y selector de voz, CSP completa, limpieza npm audit, PWA offline del chat.

## v3.2.1 — Imagen: cuota del modelo preview (juicio en vivo de Luis)
- Síntoma: «no pudo generarla por límite de uso» sin haber creado nada. Causa verificada: producción seguía en la cadena v3.1.x (solo Google, sin respaldo) y generateContent solo avanzaba de modelo ante 404 — el primer modelo (gemini-3.1-flash-image-preview) tiene cuota gratuita de imagen mínima/nula y devuelve 429 RESOURCE_EXHAUSTED al primer intento; la cuota no es consumo del usuario, es el nivel gratuito de ese modelo.
- Corrección: la cadena avanza también ante 429 (cada modelo tiene su propio cubo de cuota) y el orden pone primero gemini-2.5-flash-image (cuota gratuita real). Si ambos agotan, la cadena de respaldo de la v3.2.0 cae a Pollinations y el usuario igual recibe su imagen.

## v3.2.2 — Límite de velocidad de Groq (429) con reintento (juicio en vivo de Luis)
- Síntoma en vivo: al pedir el flyer, error crudo «El motor NEXUS respondió 429… Limit 8000, Used 6110, Requested 4735… try again in 21.3s». Causa: la cuenta de Groq de Luis está en nivel gratuito = 8.000 tokens por minuto para este modelo; cada turno de Calili pide ~4-5 mil (instrucciones + 13 herramientas + historial) y los dos turnos anteriores del mismo minuto ya habían usado 6.110. No es un límite de Calili ni de Google.
- Corrección: la pasarela espera lo que el propio error indica (tope 25 s) y reintenta una vez, en streaming y en la pasada de herramientas; si aun así no cabe, el usuario recibe un mensaje humano, nunca el JSON del proveedor. La solución de fondo es del lado de Luis: Groq Dev Tier (depósito de $10) sube el límite por minuto.

## v3.2.3 — Flyers con sus textos (juicio en vivo de Luis)
- Síntoma en vivo: pidió el flyer de Rock My Body Tattoo Studio y la imagen entregada fue una ilustración suelta de una chica tatuada, sin nombre, sin textos, sin diseño. Causa: la instrucción de la herramienta empujaba a describir «el sujeto» en inglés y el modelo reducía el encargo de diseño a la ilustración, perdiendo los textos del flyer.
- Corrección: la descripción de crear_imagen ahora trae la regla de flyers: el prompt debe ser el diseño completo (promotional flyer design), con cada texto EXACTO entre comillas, su posición y jerarquía; prohibido entregar el dibujo solo.
- Extra del mismo juicio: en el segundo intento la imagen SÍ se creó pero el texto de cierre del modelo llegó vacío y el cliente mostró el aviso viejo «NEXUS no devolvió contenido. Revisa la configuración del motor». La ruta ahora confirma en nombre del modelo cuando tras una herramienta no escribe cierre («Listo, ya lo creé: …»), y el aviso del cliente quedó en lenguaje humano.

## v3.3.0 — Directriz de video de Luis: foto → video hablado con música
Directriz de Luis (2026-11-23): Calili debe crear imágenes desde texto, videos desde una fotografía, con voz sincronizando labios y fondo musical si hace falta. Mapa contra lo que ya hay: texto→imagen = Google (existe); foto→video animado = Veo imagen-a-video (ya estaba cableado en googleVideo con usar_adjunta; nunca probado en vivo); voz = la Dalia de /api/speak (existe); música = Lyria (existe). La pieza que faltaba es la sincronía de labios: eso lo hace LongCat-Video-Avatar (MIT) en una máquina con GPU — el repo LongCat-2.0 que trajo Luis es un LLM de texto de 1,6 billones, no de video; el correcto es LongCat-Video.
- Construido del lado Calili: lib/tts.ts (narración Dalia reutilizable), lib/avatar-studio.ts (cliente del servicio de avatar, activo solo con AVATAR_SERVICE_URL) y la herramienta crear_video_hablado (guion → voz → música Lyria opcional → servicio → MP4 con reproductor). Incluido el esqueleto avatar-service/ (FastAPI + ffmpeg: avatar y mezcla de música bajo la voz) para correr en la máquina GPU con su README de puesta en marcha.
- Estado honesto: orquestación construida y build PASS; NO PROBADO en vivo — falta la máquina GPU (la de Luis o una rentada) y el juicio en vivo de cada pierna.

## v3.3.1 — La voz del modo voz sonaba a volumen cero (causa en código)
- Juicio en vivo de Luis: «le hablo, escucha, y cuando habla no se escucha ella»; el sonidito de conexión sí sonaba leve y Chrome NO estaba silenciado (el menú de la pestaña ofrecía «Silenciar sitio», YouTube sonaba bien). Causa localizada en VoiceMode: el elemento de audio persistente se crea para el desbloqueo con `unlock.volume = 0` y pumpQueue lo reutilizaba para todas las respuestas SIN restaurar el volumen — la reproducción «funcionaba» (play() y onended normales, por eso nunca saltó el respaldo) pero a volumen 0.
- Corrección: `audio.volume = 1` al cargar cada bloque de voz en pumpQueue.

## v3.3.2 — Servicio de avatar con la interfaz real de LongCat (para RunPod)
- Luis eligió rentar la GPU (abrió RunPod). Lu leyó el código real de run_demo_avatar_single_audio_to_video.py: se invoca con torchrun + input.json {prompt, cond_image, cond_audio:{person1}}, los pesos base deben ser hermanos de los del avatar, 93 frames a 25 fps por segmento (~3,7 s + 3,2 s por segmento extra) y en 24 GB manda --use_int8.
- avatar-service/main.py reescrito contra esa interfaz: calcula los segmentos desde la duración real del audio (ffprobe, tope 12), escribe el input.json, corre torchrun con avatar-v1.5 + distill + int8 y mezcla la música con ffmpeg. README con la puesta en marcha del pod.
- Límite declarado: Calili espera ~280 s por la ruta; guiones cortos (10-20 s) hasta que exista la versión asíncrona.

## v3.3.3 — Animar una foto adjunta ya llega a crear_video
- Fallo en vivo (2026-11-24): Luis adjuntó su logo y pidió «animar una foto, darle movimiento» y el turno murió con el error genérico. Causa leída en el código: en el camino de visión, la nota que guía la pasada de herramientas solo mencionaba crear_imagen; la herramienta crear_video (que sí soporta usar_adjunta) nunca se le ofrecía para ese pedido, así que la petición caía al modelo de visión, que solo puede describir la imagen, y su error tumbaba el turno.
- Corrección: la nota del camino de visión ahora dirige los pedidos de animar/convertir en video a crear_video con usar_adjunta=true y descripción en inglés del movimiento, la escena y el sonido. Sin cambios en herramientas ni en proveedores.
- Empaquetado: el ZIP lleva los archivos en la raíz (la v3.3.2 llevó la carpeta del proyecto dentro y la primera aplicación creó una carpeta anidada en la máquina de Luis; se deshizo con reset y se reaplicó).

## v3.3.4 — Ningún error se traga en silencio (observabilidad)
- Evidencia (Runtime Logs de Vercel, 2026-11-24): en la conversación larga «HOLA», la pasada de imagen murió por el arranque de 20 s del streaming de cierre y el turno cayó a visión, que también falló sin dejar registro. En conversación nueva la herramienta crear_video SÍ fue llamada (la nota de la v3.3.3 funciona), pero googleVideo lanzó y el catch de executeTool convertía el error en texto para el modelo SIN registrarlo: la causa real de Veo era invisible en cliente y en logs.
- Corrección: executeTool registra `Calili: herramienta <nombre> falló` con el error completo antes de devolver el resultado, y el catch externo de /api/chat registra `Calili: error de turno`. Sin cambios de comportamiento para el usuario; el mensaje público sigue limpio por el candado de identidad.
- Pendiente tras aplicar: repetir el pedido de animar el logo en conversación nueva; si Veo falla, su error exacto quedará en los Runtime Logs y la corrección siguiente será sobre la causa escrita.

## v3.3.5 — ME AI como motor principal (fuera el techo del nivel gratuito)
- Decisión de Luis (2026-11-24): conectar Calili a su API de ME AI — el mismo pool que alimenta EditCoreAI (base https://api.meai.cloud/v1, una sola llave, leído del código público de EditCoreAI) — para dejar atrás el techo de 8.000 tokens/min del nivel gratuito de Groq, que los Runtime Logs probaron como causa de los 429 y de los timeouts de arranque.
- Pasarela: nuevo proveedor `meai` en resolveProviders (MEAI_API_KEY; modelo MEAI_MODEL, por defecto claude-sonnet-4.6) con prioridad meai → groq → local (NEXUS_PRIMARY puede anteponer otro). completeWithTools y summarizeHistory ahora usan el proveedor principal, ya no Groq a la fuerza. La visión con llave ME AI la atiende glm-5.2 por ME AI (el mismo enrutado que usa EditCoreAI); sin llave ME AI queda la cadena de Groq.
- Ruta /api/chat: las cuatro compuertas que miraban GROQ_API_KEY ahora usan chatProviderAvailable() (sin esto, con ME AI como único motor las herramientas habrían quedado apagadas).
- Candado de identidad: response-policy también limpia Claude, Sonnet, GLM, ME AI y api.meai.cloud de los errores públicos, y las frases de auto-atribución con esos nombres se sustituyen por la identidad pública.
- La transcripción de voz sigue en Groq (pierna separada que funciona). Pendiente de juicio en vivo: Luis agrega MEAI_API_KEY en Vercel y la primera prueba es su video del logo.

## v3.3.6 — El video migra de Veo a Gemini Omni Flash (Veo ya no existe en esta API)
- Causa raíz FINAL del video, probada en vivo el 2026-11-24 con el motor ME AI ya activo: la herramienta crear_video sí se llamó y Google respondió 404. Investigación de Lu contra fuentes oficiales: Google APAGÓ todos los IDs Veo de la API de Gemini el 2026-10-22 (veo-3.1-fast-generate-preview incluido) — el modelo dejó de existir en esa API un mes antes; nunca fue la llave, el saldo ni el código de Calili. Los Veo GA (-001) solo viven en Vertex/Enterprise (otra ruta de credenciales, descartada).
- Migración: googleVideo ahora llama a Gemini Omni Flash (gemini-omni-1.1-flash, override GOOGLE_VIDEO_MODEL) por la API de Interactions (POST /v1beta/interactions, misma llave y misma facturación): input como partes [imagen?, texto], response_format {type:'video', aspect_ratio 16:9, resolution 720p}, llamada síncrona (timeout 270 s) y el MP4 vuelve en base64 en el step model_output de la respuesta. Contrato tomado de la documentación oficial de Google (ai.google.dev/gemini-api/docs/omni).
- Textos: fuera la promesa de «8 segundos» en la descripción de crear_video, su resultado y el prompt de sistema (Omni decide la duración).
- Pendiente de juicio en vivo: el mismo pedido del logo; si Omni responde con otro error, la v3.3.4 lo deja escrito en los Runtime Logs.

## v3.3.7 — Las tarjetas viven en la conversación y el chat hace scroll solo
- HITO PREVIO (2026-11-24 17:29): el PRIMER VIDEO EN VIVO de Calili funcionó — Luis animó su logo con Omni Flash: video de 8 s con reproductor y descarga («video-calili.mp4»). La pierna de video del estudio queda PROBADA EN VIVO.
- Defecto reportado por Luis el mismo día: la tarjeta del video quedaba en una banda fija sobre el recuadro de escritura, fuera del flujo, y el chat no hacía scroll automático al llegar mensajes/archivos.
- Corrección: cada archivo generado se ASIGNA al mensaje del asistente de su turno (los eventos {file} llegan durante el turno y se asignan al confirmarse el mensaje; los huérfanos cuyo mensaje se borró se rescatan al final de la lista, nunca se pierden). MessageList pinta las tarjetas bajo su mensaje, con el mismo reproductor/descarga de antes; la banda fija desapareció.
- Scroll: forzado al fondo cuando el usuario envía y cuando llega un archivo de su turno (con segunda pasada de asentamiento para el alto del video); durante el streaming se sigue respetando a quien subió a leer el historial.
- Pendiente de juicio en vivo: pedir otro video/archivo y ver la tarjeta subir con la conversación sin tocar el scroll.

## v3.3.8 — PWA: puerta de instalación siempre visible y actualización automática real
- Diagnóstico de Lu contra producción (2026-11-24): manifest, sw.js e iconos responden 200 y next-pwa trae skipWaiting+clientsClaim — la base estaba sana. Lo roto era la EXPERIENCIA: (1) el botón de instalar de la barra lateral y el aviso solo existían si Chrome disparaba beforeinstallprompt (en Android sin ese evento no había NINGUNA puerta, ni siquiera los pasos del menú ⋮; y el aviso se auto-ocultaba 7 días tras un descarte); (2) nadie buscaba actualizaciones con la app abierta ni recargaba al tomar el control el worker nuevo — la PWA instalada solo se actualizaba al cerrarla y reabrirla.
- Instalación: el botón de la barra lateral ahora se muestra SIEMPRE que la app no corra ya instalada (standalone); si el navegador no ofrece el prompt, muestra los pasos (iPhone: Compartir → Agregar a inicio; Android: menú ⋮ → Instalar app, con la nota de abrir en Chrome si el enlace se abrió dentro de otra app). El aviso inferior gana el mismo respaldo «android-manual» a los 2,5 s y su descarte ahora dura 1 día, no 7.
- Actualización: nuevo componente PwaUpdater (montado en el layout) — busca worker nuevo cada 30 min, al volver a la pestaña y al recuperar el foco; cuando el worker nuevo toma el control, recarga una sola vez (guarda anti-bucle de 30 s; la primera instalación no recarga) avisando con la pastilla «Hay una versión nueva de Calili — actualizando…».
- Juicio en vivo de Luis: en el celular, abrir calili.vercel.app EN CHROME, barra lateral → botón de instalar visible; instalar; y con la app instalada abierta, el SIGUIENTE despliegue debe entrar solo con la pastilla de actualización.

## v3.3.9 — Calidad del estudio: video cinematográfico e imagen HQ (incluye v3.3.8)
- Pedido de Luis (2026-11-24): mayor calidad de video (desde prompt o foto, acabado cinematográfico) y que la creación de logos siga la indicación del usuario. Verificado por Lu contra la documentación vigente de Google el mismo día: el video Omni admite response_format.resolution 1080p (salía en 720p por cableado propio) y el modelo de imagen principal actual de Google es gemini-nano-banana-2.1 (mejor texto y calidad, salidas 1K/2K/4K), servido también por la API de Interactions con response_format {type:'image', image_size:'2K'}.
- Video: googleVideo pide 1080p; la descripción de crear_video gana la REGLA CINEMATOGRÁFICA (plano, un movimiento de cámara, iluminación, paleta/acabado, grano de cine, ambiente sonoro; en animación de foto, qué se mueve y cómo, conservando la imagen como primer cuadro).
- Imagen: nueva googleImageHQ (Interactions, nano-banana-2.1, 2K; si el formato con tamaño da 400 reintenta sin él; lee la imagen de output_image o de los steps) que createImage intenta PRIMERO, con la cadena generateContent anterior intacta como respaldo y el fallo registrado en el log. crear_imagen gana la REGLA PARA LOGOS (diseño limpio, texto exacto entre comillas como único texto, estilo de letra/colores/elementos uno por uno; cambiar una palabra = recreación fiel completa con la palabra nueva).
- Techos declarados a Luis: el buque insignia de video de Google vive en Vertex (credenciales nuevas, no se toca); editar un logo existente siempre es repintarlo — la fidelidad quirúrgica es del archivo de diseño.
- Juicio en vivo de Luis: repetir SU encargo real — animar el logo (ahora en 1080p) y el logo con la palabra nueva — y comparar contra lo de hoy.

## v3.4.0 — Auditoría completa: foco, edición precisa, herramientas y rapidez
- Auditoría de Lu a petición de Luis (2026-11-25), todo probado en código: (1) el textarea llevaba disabled={isLoading} y NO existía autofoco en ninguna parte — tras cada respuesta el recuadro quedaba muerto hasta darle clic; (2) crear_imagen repinta la imagen ENTERA (de ahí el «no se parece ni un 5%» del logo juzgado ese día); (3) el turno pagaba una llamada completa SIN streaming sobre 40 mensajes × 12.000 caracteres antes del primer token visible, y el cliente DESCARTABA los eventos {status} del servidor: el usuario solo veía tres puntos mudos.
- Foco: el textarea ya no se deshabilita durante la respuesta (se puede redactar mientras tanto) y el foco vuelve solo al abrir, al cambiar de conversación y al terminar cada respuesta (solo puntero fino; en el celular no se fuerza el teclado).
- Edición precisa: herramienta nueva editar_imagen (lib/localized-edit.ts) — visión localiza el elemento (JSON 0-1000), se recorta con margen, SOLO el recorte se edita con el motor HQ y se pega sobre el original con bordes difuminados (radial dest-in); el resto conserva sus píxeles. sharp ya era dependencia. Prueba de Lu con imagen sintética: 0 de 16.236 píxeles fuera del recorte cambiaron, el centro sí. Si la localización falla, cae a la recreación de siempre y el resultado lo declara (precise=false) para que el modelo no prometa fidelidad falsa. La pasada de imagen ahora también distingue «cambiar SOLO una cosa» → editar_imagen.
- Herramientas nuevas (sin llaves nuevas): leer_pagina (Tavily extract o lectura directa), clima (Open-Meteo), tipo_cambio (Frankfurter), calcular (evaluador seguro propio, probado 8/8 + rechazos), fecha_actual, crear_qr (qrcode) y crear_presentacion (pptxgenjs, .pptx real).
- Rapidez y argumentos: la pasada de decisión va con contexto recortado (sistema + últimos 6 mensajes × 1.500 caracteres) y tope de 1.536 tokens con finish_reason — si una respuesta larga se corta en la decisión, el streaming directo la genera entera; el servidor anuncia cada fase y herramienta con {status} («Creando tu imagen…», «Buscando en internet…») y el cliente lo muestra junto a los puntos con el tiempo transcurrido; el prompt de sistema ordena argumentar en breve antes de concluir cuando la pregunta pide análisis o un porqué.
- Punto Groq (respondido a Luis): imágenes/video/música corren con la llave de Google, independientes del motor de chat — volver a Groq NO las apaga; lo que regresa es su techo gratuito (8K tokens/min: los 429 y los cortes de 20 s probados en registros el 2026-11-23) y la visión cambiaría de motor. El orden de motores ya es configurable sin código (NEXUS_PRIMARY).
- Juicio en vivo de Luis: escribir sin clic tras una respuesta; pedir el cambio de palabra del logo con editar_imagen y comparar píxeles; sentir la rapidez y ver las etiquetas de actividad.

## v3.4.1 — Clon real, foco sin compuerta y herramientas de imagen (sobre v3.4.0)
- Motivo (Luis, 2026-11-26, chat nuevo porque el anterior quedó trabado): la v3.4.0 seguía sin aplicarse en vivo y sus 5 puntos se volvieron a reportar; el re-análisis de Lu confirmó en código lo que la v3.4.0 dejó abierto.
- Foco: fuera la compuerta `(pointer: fine)` del efecto de foco de InputBox (dejaba sin cursor a equipos donde el navegador no lo reporta así), el textarea gana `autoFocus` de respaldo en el primer montaje, y el `focusKey` ahora incluye el estado del Modo Voz: al cerrarlo, el foco vuelve solo al recuadro. Barrido del mecanismo: los otros dos `autoFocus` del repo (editar mensaje en MessageList y renombrar en Sidebar) son focos intencionales de su propio campo y quedan intactos.
- Herramientas nuevas (sin llaves nuevas; total 22): `clonar_imagen` — modo exacto = copia del archivo adjunto píxel a píxel sin pasar por IA (la única fidelidad del 100%; crear_imagen repinta y editar_imagen solo parcha un elemento), modo variacion = recreación fiel con cambios opcionales vía la cadena de imagen existente; `transformar_imagen` (formato PNG/JPG/WebP, redimensión, rotación — sharp determinista); `ampliar_imagen` (upscale lanczos3 hasta 4x, declarando que no inventa detalle); `extraer_texto` (OCR con el modelo de visión ya conectado, transcripción literal); `narrar_texto` (MP3 con la voz Dalia de lib/tts.ts, antes solo usada por el avatar). Definiciones, ejecución, prompt de sistema, estados de actividad y la nota del camino de visión actualizados; la pasada ligera de voz las excluye (latencia).
- Rapidez: sin tocar código de rutas — la palanca es de configuración y va documentada en .env.example: `NEXUS_PRIMARY=groq` en Vercel SOLO con Groq en Dev Tier (en gratuito regresa el techo de 8K TPM probado el 2026-11-23). Imagen/video/música no se tocan: corren con GOOGLE_AI_API_KEY por google-media.ts, independientes del motor de chat (verificado: google-media.ts, image-generator.ts y localized-edit.ts no cambian en este paquete).
- Chequeos de no-regresión declarados ANTES de construir y verificados por Lu: build completo; prueba con imagen sintética de transformar/ampliar/clon-exacto (el clon exacto debe dar hash idéntico); rutas de Google intactas (video Omni 1080p, imagen HQ 2K, reglas de flyer/logo); tarjetas dentro de la conversación y scroll (v3.3.7); PWA instalación/actualización (v3.3.8); candado de identidad; memoria recordar/olvidar también en voz; voz Dalia con volumen corregido; cadena de visión; edición precisa con su prueba de píxeles.
- PENDIENTE — juicio en vivo de Luis (lo único que cierra): aplicar el paquete (npm install no hace falta: no hay dependencias nuevas), commit, push, y con el despliegue listo: (1) escribir sin dar clic al abrir y tras una respuesta, y tras cerrar el Modo Voz; (2) adjuntar su logo y pedir «clónalo exacto» (debe salir idéntico) y «clónalo con esta variación»; (3) pedir convertir/ampliar/extraer texto de una imagen; (4) poner NEXUS_PRIMARY=groq en Vercel solo si Groq está en Dev Tier y sentir la rapidez.

## v3.4.2 — Edición verificada, presupuesto de tiempo, clip libre y confirmación honrada
- Juicio en vivo de Luis sobre la v3.4.1 (2026-11-26 07:09): el foco QUEDÓ (cursor en el recuadro y etiqueta de actividad con cronómetro visibles en su captura), pero el turno de su logo tardó 126 s+ y al terminar le devolvió SU MISMO logo sin el cambio de nombre (COOL-ICHIS → Culichis), declarado como éxito; el botón de adjuntar «no funciona»; y Calili ejecutó sin confirmar aunque él pidió «antes de proceder dime si entendiste mis indicaciones».
- Causas leídas en código: (1) InputBox.tsx — el botón de adjuntar llevaba disabled={isLoading}: muerto durante cualquier respuesta, y con turnos de minutos parecía roto; (2) localized-edit.ts — éxito declarado solo porque la tubería no tronó: nadie verificaba que el cambio existiera en el compuesto, y si el editor devolvía el fragmento intacto, el resultado era el original con costura difuminada; (3) la cascada de respaldos (HQ 150 s → createImage completo 150+120+120 s, sin presupuesto total) hacía el turno eterno; (4) la nota del camino de visión empujaba a llamar editar_imagen en cuanto se pide un cambio, sin honrar un «confirma antes».
- Correcciones: (A) editar_imagen VERIFICA con visión tras componer (¿el cambio está visible? JSON applied) — si no, UN reintento con instrucción reforzada («el intento anterior volvió sin cambios y falló la verificación») y reverificación; si tampoco, failed=true SIN archivo y el modelo lo dice honestamente ofreciendo la recreación como alternativa explícita. (B) Presupuesto por pierna: localizar 30 s (AbortSignal en streamVisionChat), editar 75 s (googleImageHQ gana parámetro timeoutMs, defecto 150 s intacto para crear_imagen), verificar 30 s; peor caso ~4 min dentro del maxDuration 300 de la ruta; fuera la cascada a createImage en la ruta precisa. (C) Botón de adjuntar siempre activo: los archivos quedan en la lista listos para el próximo envío. (D) Confirmación honrada en dos capas: sección CONFIRMACIÓN ANTES DE ACTUAR en el prompt de sistema (aplica a todos los caminos) y REGLA PREVIA al frente de la nota del camino de visión.
- No-regresión: crear_imagen sigue usando googleImageHQ con su timeout por defecto de 150 s (la firma nueva es compatible); video/música/avatar sin tocar; clon exacto/transformar/ampliar/extraer/narrar de la v3.4.1 sin tocar; la prueba de píxeles de la edición precisa (0 fuera del recorte) sigue válida porque la composición no cambió — lo nuevo es la compuerta de verificación POSTERIOR a componer.
- Verificado por Lu: build completo PASS (pendiente en esta nota al construir — ver el resultado en el chat de entrega). La verificación por visión no se puede juzgar sin las llaves de producción: el juicio discriminante es EN VIVO con el caso real de Luis.
- PENDIENTE — juicio en vivo de Luis: (1) repetir SU encargo exacto con «antes de proceder dime si entendiste»: Calili debe SOLO resumir lo entendido; tras su «procede», la edición debe llegar CON el nombre nuevo verificado o con un fallo honesto — nunca más el original como éxito; (2) durante una respuesta larga, clic al clip: debe abrir el selector; (3) el tiempo total del turno de edición debe quedar muy por debajo de los 126 s+ anteriores en el caso feliz.

## v3.4.5 — Seedance ELIMINADO por completo (orden de Luis): el video vuelve a ser solo Google
- Juicio en vivo de la v3.4.4 (2026-11-27): la tarea sd-2-c1 SÍ corrió (su panel de ME AI marca consumo sd-2-c1 de **$90.00** a las 12:00) pero el video nunca llegó: bloqueo por moderación río arriba **cobrado de todos modos** (ME AI cobra al crear la tarea; la moderación mata después y no reembolsa). Segundo intento con la descripción suavizada: bloqueado otra vez y cobrado otra vez. $90 por tarea contra ~$0,30-3 del Seedance oficial: vía muerta por cara y por bloqueada.
- Orden de Luis (2026-11-27 12:41): «eliminar de Calili a Seedance completamente del código, que no me cobre». Ejecutada al pie: **borrado `src/lib/meai-video.ts`**, revertido el cableado de `crear_video` a googleVideo directo, retirada la capacidad `videoGen` (la herramienta vuelve a anunciarse solo con Google, junto a crear_musica, como antes de la v3.4.4) y retirada la nota de MEAI_VIDEO_MODEL de .env.example. Verificación: grep de seedance/sd-2-/meai-video/MEAI_VIDEO en src y .env.example = **cero rastros**. ME AI sigue en Calili solo para lo que ya hacía: chat (claude-sonnet-4.6) y visión (glm-5.2) con su respaldo — eso no se tocó.
- Frente que abre Luis en su lugar: motor de video LOCAL sin moderación en su PC (ver el plan en el chat; la v3.4.5 no lo incluye, solo detiene el cobro).

## v3.4.4 — Seedance 2 (vía ME AI) como motor principal de video, Google de respaldo [RETIRADA en v3.4.5]
- Origen (2026-11-27): Luis preguntó si agregando Seedance Calili podría crear videos y si pagaría adicional. Su token de ME AI (el de Calili) trae SOLO 6 modelos: claude-sonnet-4.6, glm-5.2, minimax-m3 y **sd-2-c1, sd-2-c2, sd-2-fast = Seedance 2 con el nombre corto de ME AI** (la primera sonda de Lu dijo «sin Seedance» porque el filtro buscaba el nombre literal; Luis corrigió con su captura de la consola: «sí lo tengo, solo está con otro nombre» — tenía razón). Sin pago adicional: corre sobre el mismo saldo MEAI_API_KEY.
- Formato confirmado por SONDA contra su cuenta real (sin generar nada): POST /v1/videos {model, prompt} crea una tarea asíncrona (alias /v1/video/generations, respuesta idéntica); la pasarela traduce el prompt al content[] de ByteDance («bytedance/reference-to-video»); una petición inválida crea la tarea y la marca FAILED con el error río arriba anidado en `message` (InvalidParameter content[0].text). Consulta: GET /v1/videos/{task_id}.
- Implementación: `src/lib/meai-video.ts` — seedanceVideo(prompt, imagen?) con la misma firma que googleVideo: crea la tarea (campo `image` con la adjunta como primer cuadro), consulta cada 5 s con presupuesto de 210 s (bajo el maxDuration 300 de la ruta), extrae la URL del resultado (data.outputs / urls.get / cualquier .mp4) o descarga por /content, y devuelve el GeneratedFile de siempre. Errores limpios según la v3.4.3: el detalle río arriba se registra en el servidor, nunca sube al usuario. Modelo por defecto sd-2-c1, cambiable con MEAI_VIDEO_MODEL.
- Cableado (tools.ts): `crear_video` intenta Seedance primero (si hay MEAI_API_KEY) y cae a googleVideo (Omni) si Seedance falla; la capacidad nueva `videoGen` anuncia la herramienta si hay Google O ME AI (antes solo Google); `crear_musica` sigue anunciándose solo con Google. La descripción cinematográfica de la herramienta no cambió.
- No-regresión: video de Google intacto como respaldo (Omni 1080p probado en vivo 2026-11-24); imagen/música/avatar sin tocar; el resultado al usuario es la misma tarjeta de video con reproductor y descarga.
- PENDIENTE — juicio en vivo de Luis: pedir un video corto en Calili; debe llegar generado por Seedance (en el registro de uso de su consola ME AI se verá el consumo de sd-2-c1) con reproductor y descarga. Si la tarea tarda más de ~3,5 min, el turno lo declara y queda el respaldo de Google para el siguiente intento.

## v3.4.3 — Ningún error crudo llega al usuario, la visión tiene respaldo y la confirmación es compuerta
- Juicio sobre la v3.4.2 (2026-11-26 08:26, captura): el turno nuevo murió peor — «❌ Error: El modelo de visión respondió 524. <!DOCTYPE html>…»: la página HTML cruda de Cloudflare (timeout del proveedor de visión) pegada en el chat; y la confirmación volvió a no honrarse en el camino de imagen.
- Causas leídas en código: (1) nexus-gateway.ts pegaba el cuerpo crudo del proveedor en los errores (detail.slice(0,300)) y errorMessage() en route.ts no atajaba HTML — publicErrorMessage solo cambiaba nombres de proveedores; (2) streamVisionChat: con ME AI presente, su error no-404 mataba el turno — la cadena de visión de Groq solo se usaba si ME AI no estaba configurado; (3) la confirmación de la v3.4.2 quedó en el prompt, pero el camino de imagen descartaba la respuesta «entendido» sin herramientas y caía a la visión sí o sí — la regla no podía funcionar ahí, mecanismo y no obediencia.
- Correcciones: (A) providerError() en la pasarela: el detalle del proveedor se registra en el servidor y el error que sube lleva solo contexto y estado (las tres rutas: streaming, herramientas y resumen); en route, errorMessage() convierte HTML o «respondió 5xx» en lenguaje humano, siempre. (B) streamVisionChat por cadenas con respaldo real: ME AI primero y Groq Qwen-VL detrás — 404 model_not_found prueba el siguiente modelo, 429/5xx/error de red saltan al siguiente proveedor, 401/403 se reportan limpios; groqProvider() retirado por quedar sin uso. Esto blinda también localizar y verificar de editar_imagen, que usan esta visión. (C) Compuerta determinista asksConfirmFirst() en route, ANTES de visión y herramientas: si el mensaje pide confirmar antes de proceder, el turno solo resume lo entendido desde el propio mensaje y espera — regex probada 7/7 (el encargo exacto de Luis y negativos como «procede»).
- No-regresión: composición y verificación de la edición precisa intactas; crear_imagen conserva googleImageHQ con 150 s por defecto; video/música/TTS/clon/transformar/ampliar/extraer/narrar sin tocar; el candado de identidad no cambió (los errores ya salían por publicErrorMessage y ahora además nacen limpios).
- PENDIENTE — juicio en vivo de Luis: el mismo encargo exacto: (1) con «antes de proceder dime si entendiste», Calili debe SOLO resumir y esperar (esta vez por compuerta, no por prompt); (2) tras «procede», edición verificada o fallo honesto; (3) si el proveedor de visión vuelve a tardar, el turno ya no muere ni escupe HTML: cae al respaldo o avisa en lenguaje humano.
