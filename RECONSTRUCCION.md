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
