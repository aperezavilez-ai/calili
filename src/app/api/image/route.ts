import { NextRequest, NextResponse } from 'next/server';
import { imageClient } from '@/lib/image-client';
import sharp from 'sharp';

export const runtime = 'nodejs';

const FLYER_WIDTH = 1080;
const FLYER_HEIGHT = 1350;

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

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[character] || character));
}

function getFlyerCopy(prompt: string) {
  const studio = prompt.match(/(?:se llama|llamado|nombre es)\s+(.+?)(?=,|\.|promoci[oó]n|promo|$)/i)?.[1]?.trim();
  const price = prompt.match(/\$\s?[\d,.]+/i)?.[0] || '$1000';
  const size = prompt.match(/hasta\s+(?:en\s+)?\d+(?:[.,]\d+)?\s*cm/i)?.[0] || 'Hasta 15 cm';
  const phone = prompt.match(/(?:cita|contacto|whatsapp)[^\d]{0,24}(\d{7,15})/i)?.[1] || prompt.match(/\b\d{10}\b/)?.[0] || 'Agenda tu cita';
  const day = prompt.match(/(?:este|el|la)\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)/i)?.[0] || 'Este sábado';

  return {
    studio: studio || 'TATTOO STUDIO',
    day: day.charAt(0).toUpperCase() + day.slice(1),
    price,
    size: size.charAt(0).toUpperCase() + size.slice(1),
    phone: phone === 'Agenda tu cita' ? phone : `Agenda tu cita: ${phone}`,
  };
}

function getBackgroundUrl(prompt: string, fallback?: string) {
  if (fallback) return fallback;
  const backgroundPrompt = 'dramatic professional tattoo studio interior, black ink flash art, red accent lighting, editorial advertising photography, no people, no letters, no words, no logos';
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(backgroundPrompt)}?width=1080&height=1350&nologo=true&enhance=true&seed=${Math.floor(Math.random() * 2_147_483_647)}`;
}

async function composeFlyer(prompt: string, backgroundUrl?: string) {
  const copy = getFlyerCopy(prompt);
  let background: Buffer;

  try {
    const response = await fetch(getBackgroundUrl(prompt, backgroundUrl), { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Background image returned ${response.status}`);
    background = Buffer.from(await response.arrayBuffer());
  } catch {
    background = await sharp({
      create: { width: FLYER_WIDTH, height: FLYER_HEIGHT, channels: 3, background: { r: 25, g: 14, b: 18 } },
    }).jpeg().toBuffer();
  }

  const overlay = Buffer.from(`<svg width="${FLYER_WIDTH}" height="${FLYER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#09090b" stop-opacity=".82"/><stop offset=".46" stop-color="#09090b" stop-opacity=".18"/><stop offset="1" stop-color="#09090b" stop-opacity=".9"/></linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#shade)"/>
    <rect x="64" y="64" width="952" height="1222" rx="18" fill="none" stroke="#ef4444" stroke-width="4"/>
    <text x="540" y="190" text-anchor="middle" fill="#fca5a5" font-family="Arial, sans-serif" font-size="34" font-weight="700" letter-spacing="7">PROMOCIÓN ESPECIAL</text>
    <text x="540" y="290" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="52" font-weight="900" textLength="900" lengthAdjust="spacingAndGlyphs">${escapeXml(copy.studio.toUpperCase())}</text>
    <line x1="250" y1="340" x2="830" y2="340" stroke="#ef4444" stroke-width="5"/>
    <text x="540" y="930" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="42" font-weight="700">${escapeXml(copy.day)}</text>
    <text x="540" y="1050" text-anchor="middle" fill="#fca5a5" font-family="Arial, sans-serif" font-size="38" font-weight="700">TATUAJE DESDE</text>
    <text x="540" y="1160" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="100" font-weight="900">${escapeXml(copy.price)}</text>
    <text x="540" y="1215" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="30" font-weight="600">${escapeXml(copy.size)}  •  ${escapeXml(copy.phone)}</text>
  </svg>`);

  const output = await sharp(background)
    .resize(FLYER_WIDTH, FLYER_HEIGHT, { fit: 'cover' })
    .composite([{ input: overlay }])
    .jpeg({ quality: 90 })
    .toBuffer();

  return `data:image/jpeg;base64,${output.toString('base64')}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, size, quality, flyer } = body;

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
      if (flyer) {
        const imageUrl = response.data?.[0]?.url;
        const flyerUrl = await composeFlyer(prompt, imageUrl);
        return NextResponse.json({ ...response, data: [{ url: flyerUrl, revised_prompt: prompt }] });
      }
      return NextResponse.json(response);
    } catch (providerError) {
      console.error('El proveedor principal de imágenes no respondió:', providerError);
      const fallback = getFallbackImage(prompt, size || '1024x1024');
      if (flyer) {
        const flyerUrl = await composeFlyer(prompt, fallback.data[0].url);
        return NextResponse.json({ ...fallback, data: [{ url: flyerUrl, revised_prompt: prompt }] });
      }
      return NextResponse.json(fallback);
    }
  } catch (error: any) {
    console.error('Error en /api/image:', error);
    return NextResponse.json(
      { error: error.message || 'Error al generar imagen' },
      { status: 500 }
    );
  }
}
