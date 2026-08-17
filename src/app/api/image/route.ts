import { NextRequest, NextResponse } from 'next/server';
import { imageClient } from '@/lib/image-client';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, size, quality } = body;

    if (!prompt) {
      return NextResponse.json(
        { error: 'El prompt es requerido' },
        { status: 400 }
      );
    }

    const response = await imageClient.generate({
      prompt,
      size: size || '1024x1024',
      quality: quality || 'standard',
      n: 1,
    });

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Error en /api/image:', error);
    return NextResponse.json(
      { error: error.message || 'Error al generar imagen' },
      { status: 500 }
    );
  }
}
