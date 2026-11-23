import { NextRequest, NextResponse } from 'next/server';
import {
  streamNexusChat,
  streamVisionChat,
  completeWithTools,
  NexusConfigError,
  type NexusMessage,
} from '@/lib/nexus-gateway';
import { buildSystemPrompt } from '@/lib/system-prompt';
import { toolCapabilities, toolDefinitions, executeTool } from '@/lib/tools';
import type { GeneratedFile } from '@/lib/file-generator';

// nodejs: en desarrollo debe poder alcanzar el NEXUS local (127.0.0.1).
export const runtime = 'nodejs';

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

    const caps = toolCapabilities();
    const systemPrompt = buildSystemPrompt({
      createFiles: caps.createFiles,
      webSearch: caps.webSearch,
      readRepos: caps.readRepos,
      vision: true,
    });

    const conversation = (messages as NexusMessage[]).filter((m) => m.role !== 'system');
    const history = compactHistory(conversation);
    const fullMessages: NexusMessage[] = [{ role: 'system', content: systemPrompt }, ...history];

    const encoder = new TextEncoder();
    const send = (
      controller: ReadableStreamDefaultController,
      payload: Record<string, unknown>,
    ) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

    const stream = new ReadableStream({
      async start(controller) {
        try {
          send(controller, { status: 'preparing' });

          // --- Camino de visión: hay imágenes adjuntas -------------------
          if (imageList.length > 0) {
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

          // --- Camino con herramientas (solo Groq) ------------------------
          const definitions = toolDefinitions(caps);
          let handled = false;
          if (definitions.length > 0 && process.env.GROQ_API_KEY) {
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
                  const execution = await executeTool(call.function.name, call.function.arguments);
                  if (execution.file) files.push(execution.file);
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
