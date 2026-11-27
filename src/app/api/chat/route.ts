import { NextRequest, NextResponse } from 'next/server';
import {
  streamNexusChat,
  streamVisionChat,
  completeWithTools,
  summarizeHistory,
  chatProviderAvailable,
  NexusConfigError,
  type NexusMessage,
  type NexusCompletion,
} from '@/lib/nexus-gateway';
import { buildSystemPrompt } from '@/lib/system-prompt';
import { requireApiUser } from '@/lib/api-auth';
import { publicErrorMessage } from '@/lib/response-policy';
import { toolCapabilities, toolDefinitions, executeTool } from '@/lib/tools';
import type { GeneratedFile } from '@/lib/file-generator';

// nodejs: las herramientas del servidor (sharp, archivos) lo requieren.
export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_HISTORY_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 12000;
const MAX_IMAGES = 5;
const MAX_IMAGE_CHARS = 5_600_000; // ~4 MB en base64 (límite de Groq)

function compactHistory(messages: NexusMessage[]): NexusMessage[] {
  return messages.slice(-MAX_HISTORY_MESSAGES).map((message) => ({
    role: message.role,
    content: message.content.slice(-MAX_MESSAGE_CHARS),
  }));
}

// La pasada que DECIDE si llamar herramientas no necesita la
// conversación entera: sistema + últimos mensajes recortados. La
// respuesta final sí va con el historial completo; esta dieta es solo
// de la decisión y es la principal palanca de rapidez del turno.
const DECISION_MESSAGES = 6;
const DECISION_CHARS = 1500;
function decisionContext(full: NexusMessage[]): NexusMessage[] {
  const [system, ...rest] = full;
  const tail = rest.slice(-DECISION_MESSAGES).map((message) => ({
    role: message.role,
    content: message.content.slice(0, DECISION_CHARS),
  }));
  return system ? [system, ...tail] : tail;
}

// Lo que el usuario LEE mientras Calili trabaja: cada fase y cada
// herramienta anuncia qué está haciendo (el cliente lo muestra junto
// a los puntos de espera, con el tiempo transcurrido).
const TOOL_STATUS: Record<string, string> = {
  crear_archivo: 'Creando tu archivo…',
  crear_presentacion: 'Armando tu presentación…',
  crear_qr: 'Generando tu código QR…',
  crear_imagen: 'Creando tu imagen…',
  clonar_imagen: 'Clonando tu imagen…',
  transformar_imagen: 'Transformando tu imagen…',
  ampliar_imagen: 'Ampliando tu imagen…',
  extraer_texto: 'Extrayendo el texto de tu imagen…',
  narrar_texto: 'Grabando la narración…',
  editar_imagen: 'Editando tu imagen con precisión…',
  crear_video: 'Creando tu video — puede tardar de 1 a 3 minutos…',
  crear_musica: 'Componiendo tu música…',
  crear_video_hablado: 'Creando tu video hablado — puede tardar varios minutos…',
  buscar_web: 'Buscando en internet…',
  leer_pagina: 'Leyendo la página…',
  leer_repositorio: 'Leyendo el repositorio…',
  clima: 'Consultando el clima…',
  tipo_cambio: 'Consultando el tipo de cambio…',
  calcular: 'Calculando…',
  recordar: 'Guardando en mi memoria…',
  olvidar: 'Actualizando mi memoria…',
};
function toolStatus(name: string): string {
  return TOOL_STATUS[name] ?? 'Trabajando en tu encargo…';
}

// Compuerta DETERMINISTA de confirmación (v3.4.3): si el usuario pide
// confirmar que se entendió ANTES de proceder, este turno no llama
// herramientas ni visión — el modelo solo resume lo entendido y
// espera. Antes la regla vivía solo en el prompt y el camino de
// imagen la pisaba: la pasada de decisión respondía «entendido» sin
// herramientas, ese texto se DESCARTABA y la ruta caía a la visión,
// que ejecutaba o moría en el intento (juicio de Luis, 2026-11-26).
// Mecanismo en la ruta, no obediencia del modelo.
const CONFIRM_FIRST_RE = /(antes de (proceder|hacer|continuar|seguir|empezar)|dime si entendiste|no (procedas|hagas|contin[uú]es|sigas|empieces)|conf[ií]rmame( que| si)? entend|espera (mi|a que te) confirm)/i;
function asksConfirmFirst(text: string): boolean {
  return CONFIRM_FIRST_RE.test(text);
}

// Dieta del turno (v3.4.6): la pasada de decisión con herramientas
// cuesta una generación completa SIN transmitir, con las definiciones
// de las 23 herramientas a cuestas (~16 mil caracteres). Un mensaje
// conversacional («quiero hacer una app, ¿puedes ayudarme?») pagaba
// ese peaje entero y tardó 18 s en vivo (juicio de Luis, 2026-11-27).
// Ahora: si el mensaje NO huele a trabajo de herramientas, el turno va
// directo al streaming y la primera palabra llega en segundos. El
// clasificador es determinista y está sesgado a lo seguro: un falso
// positivo solo cuesta la latencia de antes; el patrón cubre verbos y
// sustantivos de cada herramienta (crear/buscar/leer/recordar/clima/
// repo/URL…) para no dejar encargos reales sin su pasada.
const TOOL_INTENT_RE = /(https?:\/\/|github\.com|\b(crea|crear|genera|generar|dibuja|dibujar|hazme|ármame|armame|compón|compon|redacta|redactar|busca|buscar|investiga|investigar|lee|leer|revisa|revisar|analiza|analizar|clona|clonar|edita|editar|amplía|ampliar|transforma|transformar|convierte|convertir|extrae|extraer|descarga|descargar|recuerda|recordar|olvida|olvidar|apunta|apuntar|calcula|calcular)\b|\b(imagen|foto|video|música|canción|qr|presentación|diapositivas|archivo|documento|narración|audio|logo|repositorio|clima|tipo de cambio)\b|\b(me llamo|mi nombre es|no olvides|cuánto es|cuanto es)\b)/i;
function looksLikeToolWork(text: string): boolean {
  return TOOL_INTENT_RE.test(text);
}

function errorMessage(error: unknown): string {
  if (error instanceof NexusConfigError) return error.message;
  const raw = error instanceof Error ? error.message : String(error ?? '');
  // Limite de velocidad del motor: se dice en humano y sin el JSON crudo
  // del proveedor (que ademas rompia el candado de identidad).
  if (/\b429\b|rate limit/i.test(raw)) {
    return 'Estoy recibiendo demasiadas peticiones en este momento. Espera unos segundos y vuelve a intentarlo.';
  }
  if (raw.includes('{"error"')) {
    return 'El motor no pudo completar la respuesta. Inténtalo de nuevo en un momento.';
  }
  // Regla dura (v3.4.3): NINGÚN detalle técnico crudo llega al usuario.
  // Un 524 de Cloudflare pegó su página HTML entera en el chat porque
  // el error traía el cuerpo del proveedor y este filtro solo cambiaba
  // nombres. La pasarela ya no adjunta cuerpos, y aquí además: HTML o
  // estado 5xx en el mensaje = lenguaje humano, siempre.
  if (/<!doctype|<html[\s>]/i.test(raw)) {
    return 'El motor tardó demasiado en responder. Inténtalo de nuevo en un momento.';
  }
  if (/respondió 5\d\d/.test(raw)) {
    return 'El motor tardó demasiado en responder o falló en este intento. Inténtalo de nuevo en un momento.';
  }
  return publicErrorMessage(error);
}

export async function POST(req: NextRequest) {
  const apiUser = await requireApiUser(req);
  if (!apiUser) {
    return NextResponse.json({ error: 'Inicia sesión para usar Calili.' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const { messages, images } = body ?? {};

    if (
      !Array.isArray(messages) ||
      messages.some(
        (message) =>
          !message ||
          !['user', 'assistant', 'system'].includes(message.role) ||
          typeof message.content !== 'string',
      )
    ) {
      return NextResponse.json(
        { error: 'Los mensajes no tienen un formato válido' },
        { status: 400 },
      );
    }
    if (messages.length > 200) {
      return NextResponse.json(
        { error: 'La conversación es demasiado larga para una sola petición.' },
        { status: 413 },
      );
    }

    const imageList: string[] = Array.isArray(images)
      ? images.filter(
          (img): img is string =>
            typeof img === 'string' && img.startsWith('data:image/') && img.length <= MAX_IMAGE_CHARS,
        ).slice(0, MAX_IMAGES)
      : [];

    const voiceMode = (body as { voice?: unknown })?.voice === true;
    const caps = toolCapabilities();
    const systemPrompt = buildSystemPrompt({
      createFiles: caps.createFiles,
      webSearch: caps.webSearch,
      readRepos: caps.readRepos,
      vision: true,
      imageGen: caps.imageGen,
      imageEdit: caps.imageEdit,
      preciseEdit: caps.preciseEdit,
      utilities: caps.utilities,
      memory: caps.memory,
      googleMedia: caps.googleMedia,
      imageTools: caps.imageTools,
      narration: caps.narration,
    }) + (voiceMode
      ? '\n\nMODO VOZ (el usuario te escucha, no te lee): responde conversacional y breve, de 1 a 3 frases cortas. Nada de listas, tablas, encabezados ni markdown.'
      : '');

    const memoryFacts: string[] = Array.isArray((body as { memory?: unknown })?.memory)
      ? ((body as { memory: unknown[] }).memory
          .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
          .map((f) => f.trim().slice(0, 200))
          .slice(0, 40))
      : [];
    const memoryBlock = memoryFacts.length
      ? `\n\nMEMORIA DEL USUARIO (hechos que recuerdas de él de conversaciones anteriores; úsalos con naturalidad):\n${memoryFacts.map((f) => `- ${f}`).join('\n')}`
      : '';

    const conversation = (messages as NexusMessage[]).filter((m) => m.role !== 'system');
    const history = compactHistory(conversation);
    let fullMessages: NexusMessage[] = [{ role: 'system', content: systemPrompt + memoryBlock }, ...history];

    const encoder = new TextEncoder();
    const send = (
      controller: ReadableStreamDefaultController,
      payload: Record<string, unknown>,
    ) => {
      // Si el cliente ya corto, enqueue lanza: se ignora en silencio en
      // vez de convertir cada desconexion en un error de servidor.
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      } catch { /* cliente desconectado */ }
    };

    const stream = new ReadableStream({
      async start(controller) {
        // Latido: sin bytes por minutos (un video generandose), los
        // proxies cortan la conexion aunque la funcion siga viva.
        const heartbeat = setInterval(() => send(controller, { status: 'working' }), 15000);

        // Bucle agéntico (v3.4.6): ejecuta las llamadas que el modelo
        // pidió y, con los resultados a la vista, le permite pedir el
        // SIGUIENTE paso (hasta MAX_TOOL_ROUNDS rondas). Antes el turno
        // hacía UNA sola pasada: un encargo de dos herramientas
        // encadenadas (leer un repo y luego su archivo principal, buscar
        // y luego armar el QR) perdía el segundo paso. Guardia: la
        // misma llamada con los mismos argumentos no se repite.
        const MAX_TOOL_ROUNDS = 3;
        const runToolRounds = async (
          firstCompletion: NexusCompletion,
          baseMessages: NexusMessage[],
          definitions: unknown[],
        ): Promise<{ callsRun: number; files: GeneratedFile[]; workingMessages: unknown[] }> => {
          const files: GeneratedFile[] = [];
          const workingMessages: unknown[] = [...baseMessages];
          const executed = new Set<string>();
          let callsRun = 0;
          let completion = firstCompletion;
          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const fresh = completion.toolCalls.filter((call) => {
              const signature = `${call.function.name}:${call.function.arguments}`;
              return !executed.has(signature);
            });
            if (fresh.length === 0) break;
            const callsToRun = fresh.slice(0, 3);
            for (const call of callsToRun) {
              executed.add(`${call.function.name}:${call.function.arguments}`);
            }
            workingMessages.push({
              role: 'assistant',
              content: completion.content || null,
              tool_calls: callsToRun,
            });
            for (const call of callsToRun) {
              send(controller, { status: toolStatus(call.function.name) });
              const execution = await executeTool(call.function.name, call.function.arguments, { images: imageList });
              callsRun++;
              if (execution.file) files.push(execution.file);
              if (execution.memoryEvent) send(controller, { memory: execution.memoryEvent });
              workingMessages.push({ role: 'tool', tool_call_id: call.id, content: execution.resultForModel });
            }
            if (round === MAX_TOOL_ROUNDS - 1) break;
            try {
              completion = await completeWithTools(
                decisionContext(workingMessages as unknown as NexusMessage[]),
                definitions,
                req.signal,
              );
            } catch (error) {
              // Si la decisión de la ronda extra falla, se cierra con
              // lo ya hecho: el usuario recibe su respuesta con los
              // resultados en mano, no un error.
              console.error('Calili: ronda extra de herramientas falló, se cierra con lo hecho', error);
              break;
            }
          }
          return { callsRun, files, workingMessages };
        };

        try {
          send(controller, { status: 'Pensando…' });

          // Resumen rodante: si la conversacion ya no cabe completa, la
          // parte antigua viaja como resumen (el historial visible del
          // usuario nunca se toca). El cliente cachea el resumen por
          // conversacion y lo devuelve en cada mensaje (summary/summaryUpTo).
          const droppedCount = conversation.length - history.length;
          if (droppedCount > 0) {
            const clientSummary = typeof (body as { summary?: unknown })?.summary === 'string'
              ? ((body as { summary: string }).summary as string)
              : '';
            const clientUpTo = Number((body as { summaryUpTo?: unknown })?.summaryUpTo) || 0;
            let summaryText = '';
            const effectiveUpTo = Math.min(clientUpTo, droppedCount);
            if (clientSummary && effectiveUpTo === droppedCount) {
              summaryText = clientSummary;
            } else if (chatProviderAvailable()) {
              try {
                const sliceToSummarize = conversation.slice(effectiveUpTo, droppedCount);
                const transcript = sliceToSummarize
                  .map((m) => `${m.role === 'user' ? 'USUARIO' : 'CALILI'}: ${m.content}`)
                  .join('\n')
                  .slice(0, 24000);
                if (transcript) {
                  summaryText = await summarizeHistory(effectiveUpTo > 0 ? clientSummary : '', transcript);
                  send(controller, { summary: { text: summaryText, upTo: droppedCount } });
                }
              } catch (summaryError) {
                console.error('Calili: resumen de historial falló, se sigue sin resumen', summaryError);
                summaryText = clientSummary;
              }
            }
            if (summaryText) {
              fullMessages = [
                fullMessages[0],
                {
                  role: 'system',
                  content: `RESUMEN DE LA PARTE ANTERIOR DE ESTA MISMA CONVERSACIÓN (los mensajes resumidos ya no van adjuntos; el usuario sí los sigue viendo en su pantalla):\n${summaryText}`,
                },
                ...history,
              ];
            }
          }

          // --- Compuerta de confirmación: si el usuario pidió confirmar
          // antes de proceder, este turno SOLO resume lo entendido y
          // espera — sin herramientas y sin visión, haya imagen o no.
          // El resumen sale del propio mensaje del usuario, que ya trae
          // la instrucción completa; no necesita ver la imagen. --------
          const lastUserText = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
          if (asksConfirmFirst(lastUserText)) {
            send(controller, { status: 'Confirmando el encargo…' });
            const confirmNote: NexusMessage = {
              role: 'system',
              content:
                'El usuario pidió que confirmes que entendiste ANTES de proceder. Responde SOLO con un resumen breve y concreto de lo entendido: qué vas a hacer, sobre qué material y con qué cambios exactos. No ejecutes nada en este turno y cierra esperando su confirmación.',
            };
            for await (const chunk of streamNexusChat([...fullMessages, confirmNote], { signal: req.signal })) {
              send(controller, { content: chunk });
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            return;
          }

          // --- Camino de visión: hay imágenes adjuntas -------------------
          if (imageList.length > 0) {
            // Primero: ¿pide crear/recrear una imagen? El modelo de texto
            // decide con las herramientas; si llama crear_imagen, la imagen
            // adjunta viaja en el contexto del servidor (no en los args).
            if (!voiceMode && caps.imageGen && chatProviderAvailable()) {
              try {
                const note: NexusMessage = {
                  role: 'system',
                  content: 'REGLA PREVIA: si el usuario pide confirmar que entendiste ANTES de proceder («antes de proceder dime si entendiste», «no procedas hasta que confirme»), NO llames ninguna herramienta en este turno: responde solo con el resumen de lo entendido y espera su confirmación. El usuario adjuntó una imagen en este mensaje (la tienes en el servidor). Si pide ANIMAR la imagen, darle movimiento, convertirla en video o hacer un clip con ella, llama crear_video con usar_adjunta=true y una descripción en inglés del movimiento, la escena y el sonido. Si pide crear o generar una imagen nueva, llama crear_imagen con usar_adjunta=true y un prompt en inglés que describa la imagen FINAL completa. Si pide cambiar SOLO una cosa de su imagen conservando lo demás igual (cambiar una palabra de un logo, corregir un texto, quitar un elemento), llama editar_imagen con el elemento exacto y el cambio en inglés. Si pide CLONAR, duplicar o copiar su imagen, llama clonar_imagen (modo exacto para la copia idéntica; modo variacion para una versión fiel con cambios). Si pide convertir el formato, redimensionar o girar su imagen, llama transformar_imagen; si pide agrandarla o subir su resolución, ampliar_imagen; si pide leer o sacar el texto de la imagen, extraer_texto. Si solo pide analizarla o preguntar por ella, no llames herramientas.',
                };
                send(controller, { status: 'Revisando tu imagen…' });
                const completion = await completeWithTools(
                  decisionContext([...fullMessages, note]),
                  toolDefinitions(caps),
                  req.signal,
                );
                if (completion.toolCalls.length > 0) {
                  const outcome = await runToolRounds(completion, fullMessages, toolDefinitions(caps));
                  for (const file of outcome.files) send(controller, { file });
                  send(controller, { status: 'Escribiendo la respuesta…' });
                  for await (const chunk of streamNexusChat(outcome.workingMessages as unknown as NexusMessage[], { signal: req.signal })) {
                    send(controller, { content: chunk });
                  }
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  return;
                }
              } catch (error) {
                if (error instanceof NexusConfigError) throw error;
                console.error('Calili: pasada de imagen falló, se usa visión directa', error);
              }
            }

            const visionMessages: unknown[] = [{ role: 'system', content: systemPrompt + memoryBlock }];
            const lastUserIndex = history.map((m) => m.role).lastIndexOf('user');
            history.forEach((message, index) => {
              const isLastUser = index === lastUserIndex;
              if (isLastUser) {
                visionMessages.push({
                  role: 'user',
                  content: [
                    { type: 'text', text: message.content || 'Analiza esta imagen.' },
                    ...imageList.map((url) => ({ type: 'image_url', image_url: { url } })),
                  ],
                });
              } else {
                visionMessages.push(message);
              }
            });
            send(controller, { status: 'Analizando tu imagen…' });
            for await (const chunk of streamVisionChat(visionMessages, req.signal)) {
              send(controller, { content: chunk });
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            return;
          }

          // --- Modo voz: pasada ligera SOLO con memoria ------------------
          // La voz salta las herramientas pesadas por latencia, pero
          // recordar/olvidar sí viajan: Luis probó decirle "soy Luis"
          // hablando y la memoria es justo lo que espera que funcione.
          let handled = false;
          if (voiceMode && chatProviderAvailable()) {
            try {
              const memoryDefs = toolDefinitions({ ...caps, createFiles: false, webSearch: false, readRepos: false, imageGen: false, imageTools: false, narration: false, googleMedia: false, preciseEdit: false, utilities: false });
              if (memoryDefs.length > 0) {
                const completion = await completeWithTools(decisionContext(fullMessages), memoryDefs, req.signal);
                if (completion.toolCalls.length > 0) {
                  const callsToRun = completion.toolCalls.slice(0, 3);
                  const workingMessages: unknown[] = [
                    ...fullMessages,
                    { role: 'assistant', content: completion.content || null, tool_calls: callsToRun },
                  ];
                  for (const call of callsToRun) {
                    const execution = await executeTool(call.function.name, call.function.arguments, { images: imageList });
                    if (execution.memoryEvent) send(controller, { memory: execution.memoryEvent });
                    workingMessages.push({ role: 'tool', tool_call_id: call.id, content: execution.resultForModel });
                  }
                  for await (const chunk of streamNexusChat(workingMessages as unknown as NexusMessage[], { signal: req.signal })) {
                    send(controller, { content: chunk });
                  }
                  handled = true;
                } else if (completion.content) {
                  const pieces = completion.content.match(/[\s\S]{1,120}/g) ?? [];
                  for (const piece of pieces) send(controller, { content: piece });
                  handled = true;
                }
              }
            } catch (error) {
              if (error instanceof NexusConfigError) throw error;
              console.error('Calili: pasada de memoria en voz falló, se usa streaming directo', error);
            }
          }

          // --- Camino con herramientas (proveedor principal) --------------
          const definitions = toolDefinitions(caps);
          // En modo voz se salta la pasada de herramientas: la latencia manda.
          // Dieta (v3.4.6): sin olor a herramientas, tampoco hay pasada —
          // el turno cae al streaming directo de abajo y responde en
          // segundos en vez de pagar la decisión completa.
          if (!voiceMode && definitions.length > 0 && chatProviderAvailable() && looksLikeToolWork(lastUserText)) {
            try {
              const completion = await completeWithTools(
                decisionContext(fullMessages),
                definitions,
                req.signal,
              );

              if (completion.toolCalls.length > 0) {
                const outcome = await runToolRounds(completion, fullMessages, definitions);
                const files = outcome.files;
                for (const file of files) {
                  send(controller, { file });
                }
                send(controller, { status: 'Escribiendo la respuesta…' });
                let closingText = '';
                for await (const chunk of streamNexusChat(
                  outcome.workingMessages as unknown as NexusMessage[],
                  { signal: req.signal },
                )) {
                  closingText += chunk;
                  send(controller, { content: chunk });
                }
                if (!closingText.trim()) {
                  const names = files.map((f) => f.name).join(', ');
                  send(controller, {
                    content: files.length > 0
                      ? `Listo, ya lo creé: ${names}. Lo tienes arriba con su botón de descarga. Si quieres, ajusto el diseño o los textos.`
                      : 'Listo, ya quedó hecho. Si quieres, lo ajustamos.',
                  });
                }
                handled = true;
              } else if (completion.content && completion.finishReason !== 'length') {
                // Sin herramientas: se entrega la respuesta ya generada,
                // en trozos para mantener la sensación de streaming.
                // Si la decisión la cortó por longitud, NO se entrega a
                // medias: el streaming directo de abajo la genera entera.
                const pieces = completion.content.match(/[\s\S]{1,120}/g) ?? [];
                for (const piece of pieces) send(controller, { content: piece });
                handled = true;
              }
            } catch (error) {
              if (error instanceof NexusConfigError) throw error;
              // Si la pasada de herramientas falla, se cae al streaming
              // normal: el usuario nunca se queda sin respuesta por esto.
              console.error('Calili: pasada de herramientas falló, se usa streaming directo', error);
            }
          }

          // --- Camino normal: streaming directo ---------------------------
          if (!handled) {
            for await (const chunk of streamNexusChat(fullMessages, { signal: req.signal })) {
              send(controller, { content: chunk });
            }
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (error) {
          // El usuario recibe el mensaje limpio (candado de identidad),
          // pero el error real queda en el registro del servidor.
          console.error('Calili: error de turno', error);
          send(controller, { error: errorMessage(error) });
        } finally {
          clearInterval(heartbeat);
          try { controller.close(); } catch { /* ya cerrado */ }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch {
    return NextResponse.json({ error: 'La solicitud no es válida' }, { status: 400 });
  }
}
