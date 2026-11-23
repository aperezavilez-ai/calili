import { NextRequest, NextResponse } from 'next/server';
import {
  streamNexusChat,
  streamVisionChat,
  completeWithTools,
  summarizeHistory,
  NexusConfigError,
  type NexusMessage,
} from '@/lib/nexus-gateway';
import { buildSystemPrompt } from '@/lib/system-prompt';
import { toolCapabilities, toolDefinitions, executeTool } from '@/lib/tools';
import type { GeneratedFile } from '@/lib/file-generator';

// nodejs: en desarrollo debe poder alcanzar el NEXUS local (127.0.0.1).
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

function errorMessage(error: unknown): string {
  if (error instanceof NexusConfigError) return error.message;
  if (error instanceof Error) return error.message;
  return 'NEXUS no respondió.';
}

export async function POST(req: NextRequest) {
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
      memory: caps.memory,
      googleMedia: caps.googleMedia,
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
    ) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

    const stream = new ReadableStream({
      async start(controller) {
        try {
          send(controller, { status: 'preparing' });

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
            if (clientSummary && clientUpTo === droppedCount) {
              summaryText = clientSummary;
            } else if (process.env.GROQ_API_KEY) {
              try {
                const sliceToSummarize = conversation.slice(Math.min(clientUpTo, droppedCount), droppedCount);
                const transcript = sliceToSummarize
                  .map((m) => `${m.role === 'user' ? 'USUARIO' : 'CALILI'}: ${m.content}`)
                  .join('\n')
                  .slice(0, 24000);
                if (transcript) {
                  summaryText = await summarizeHistory(clientSummary, transcript);
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

          // --- Camino de visión: hay imágenes adjuntas -------------------
          if (imageList.length > 0) {
            // Primero: ¿pide crear/recrear una imagen? El modelo de texto
            // decide con las herramientas; si llama crear_imagen, la imagen
            // adjunta viaja en el contexto del servidor (no en los args).
            if (!voiceMode && caps.imageGen && process.env.GROQ_API_KEY) {
              try {
                const note: NexusMessage = {
                  role: 'system',
                  content: 'El usuario adjuntó una imagen en este mensaje (la tienes en el servidor). Si pide crear, recrear, modificar o generar una imagen, llama crear_imagen con usar_adjunta=true y un prompt en inglés que describa la imagen FINAL completa. Si solo pide analizarla o preguntar por ella, no llames herramientas.',
                };
                const completion = await completeWithTools(
                  [...fullMessages, note] as unknown[],
                  toolDefinitions(caps),
                  req.signal,
                );
                if (completion.toolCalls.length > 0) {
                  const workingMessages: unknown[] = [
                    ...fullMessages,
                    { role: 'assistant', content: completion.content || null, tool_calls: completion.toolCalls },
                  ];
                  const files: GeneratedFile[] = [];
                  for (const call of completion.toolCalls.slice(0, 3)) {
                    const execution = await executeTool(call.function.name, call.function.arguments, { images: imageList });
                    if (execution.file) files.push(execution.file);
                    if (execution.memoryEvent) send(controller, { memory: execution.memoryEvent });
                    workingMessages.push({ role: 'tool', tool_call_id: call.id, content: execution.resultForModel });
                  }
                  for (const file of files) send(controller, { file });
                  for await (const chunk of streamNexusChat(workingMessages as unknown as NexusMessage[], { signal: req.signal })) {
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

            const visionMessages: unknown[] = [{ role: 'system', content: systemPrompt }];
            history.forEach((message, index) => {
              const isLastUser = index === history.length - 1 && message.role === 'user';
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
          if (voiceMode && process.env.GROQ_API_KEY) {
            try {
              const memoryDefs = toolDefinitions({ ...caps, createFiles: false, webSearch: false, readRepos: false, imageGen: false });
              if (memoryDefs.length > 0) {
                const completion = await completeWithTools(fullMessages as unknown[], memoryDefs, req.signal);
                if (completion.toolCalls.length > 0) {
                  const workingMessages: unknown[] = [
                    ...fullMessages,
                    { role: 'assistant', content: completion.content || null, tool_calls: completion.toolCalls },
                  ];
                  for (const call of completion.toolCalls.slice(0, 3)) {
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

          // --- Camino con herramientas (solo Groq) ------------------------
          const definitions = toolDefinitions(caps);
          // En modo voz se salta la pasada de herramientas: la latencia manda.
          if (!voiceMode && definitions.length > 0 && process.env.GROQ_API_KEY) {
            try {
              const completion = await completeWithTools(
                fullMessages as unknown[],
                definitions,
                req.signal,
              );

              if (completion.toolCalls.length > 0) {
                const workingMessages: unknown[] = [
                  ...fullMessages,
                  {
                    role: 'assistant',
                    content: completion.content || null,
                    tool_calls: completion.toolCalls,
                  },
                ];
                const files: GeneratedFile[] = [];
                for (const call of completion.toolCalls.slice(0, 3)) {
                  const execution = await executeTool(call.function.name, call.function.arguments, { images: imageList });
                  if (execution.file) files.push(execution.file);
                  if (execution.memoryEvent) send(controller, { memory: execution.memoryEvent });
                  workingMessages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: execution.resultForModel,
                  });
                }
                for (const file of files) {
                  send(controller, { file });
                }
                for await (const chunk of streamNexusChat(
                  workingMessages as unknown as NexusMessage[],
                  { signal: req.signal },
                )) {
                  send(controller, { content: chunk });
                }
                handled = true;
              } else if (completion.content) {
                // Sin herramientas: se entrega la respuesta ya generada,
                // en trozos para mantener la sensación de streaming.
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
          send(controller, { error: errorMessage(error) });
        } finally {
          controller.close();
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
