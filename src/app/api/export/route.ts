import { NextRequest, NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function plainLines(markdown: string): string[] {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[Imagen]')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
}

async function createDocx(content: string): Promise<Buffer> {
  const children = plainLines(content).map((line) => {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (heading) {
      const level = heading[1].length === 1 ? HeadingLevel.HEADING_1 : heading[1].length === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      return new Paragraph({ text: heading[2], heading: level });
    }
    return new Paragraph({ children: [new TextRun(line || ' ')] });
  });

  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

async function createPdf(content: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    for (const line of plainLines(content)) {
      const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
      if (heading) {
        doc.moveDown(heading[1].length === 1 ? 0.8 : 0.35);
        doc.fontSize(heading[1].length === 1 ? 18 : heading[1].length === 2 ? 14 : 12).font('Helvetica-Bold').text(heading[2]);
        doc.font('Helvetica').fontSize(10.5);
      } else {
        doc.font('Helvetica').fontSize(10.5).text(line || ' ', { lineGap: 3 });
      }
    }
    doc.end();
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    const format = body?.format === 'pdf' || body?.format === 'docx' ? body.format : 'md';
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : 'calili-documento';

    if (!content) return NextResponse.json({ error: 'El contenido es requerido.' }, { status: 400 });

    if (format === 'md') {
      return new NextResponse(content, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${title}.md"`,
        },
      });
    }

    const bytes = format === 'pdf' ? await createPdf(content) : await createDocx(content);
    const mime = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return new NextResponse(bytes as BodyInit, {
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="${title}.${format}"`,
      },
    });
  } catch (error) {
    console.error('Error al exportar documento:', error);
    return NextResponse.json({ error: 'No se pudo generar el archivo.' }, { status: 500 });
  }
}
