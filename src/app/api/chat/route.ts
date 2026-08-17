import { NextRequest, NextResponse } from 'next/server';
import { gptClient } from '@/lib/gpt-client';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, mode } = body;

    // Modo de razonamiento: agregar instrucciones especiales
    const systemMessage = mode === 'reasoning'
      ? {
          role: 'system' as const,
          content: 'Eres un asistente AI con capacidades de razonamiento profundo. Antes de responder, piensa paso a paso y explica tu proceso de razonamiento. Usa el formato:\n\n🤔 **Razonamiento:**\n[Tu proceso de pensamiento aquí]\n\n💡 **Respuesta:**\n[Tu respuesta final aquí]'
        }
      : {
          role: 'system' as const,
          content: 'Eres Calili, un asistente AI útil, amigable e inteligente. Respondes en español de forma clara y concisa.'
        };

    const fullMessages = [systemMessage, ...messages];

    // Streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of gptClient.chatStream({ messages: fullMessages })) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`));
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error: any) {
          controller.error(error);
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('Error en /api/chat:', error);
    return NextResponse.json(
      { error: error.message || 'Error al procesar la solicitud' },
      { status: 500 }
    );
  }
}
