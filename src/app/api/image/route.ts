import { NextRequest, NextResponse } from 'next/server';
import { imageClient } from '@/lib/image-client';

export const runtime = 'edge';

function getFallbackImage(prompt: string, size: string) {
  const allowedSizes = new Set(['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792']);
  const selectedSize = allowedSizes.has(size) ? size : '1024x1024';
  const [width, height] = selectedSize.split('x');
  const seed = Math.floor(Math.random() * 2_147_483_647);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&enhance=true&seed=${seed}`;

  return {
    created: Math.floor(Date.now() / 1000),
    data: [{ url, revised_prompt: prompt }],
  };
}

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

    try {
      const response = await imageClient.generate({
        prompt,
        size: size || '1024x1024',
        quality: quality || 'standard',
        n: 1,
      });
      return NextResponse.json(response);
    } catch (providerError) {
      console.error('El proveedor principal de imágenes no respondió:', providerError);
      return NextResponse.json(getFallbackImage(prompt, size || '1024x1024'));
    }
  } catch (error: any) {
    console.error('Error en /api/image:', error);
    return NextResponse.json(
      { error: error.message || 'Error al generar imagen' },
      { status: 500 }
    );
  }
}
