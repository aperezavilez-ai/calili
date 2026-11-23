import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import ExcelJS from 'exceljs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 12000;

function trimExtractedText(text: string): string {
  return text.replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim().slice(0, MAX_EXTRACTED_CHARS);
}

export async function POST(req: NextRequest) {
  const apiUser = await requireApiUser(req);
  if (!apiUser) {
    return NextResponse.json({ error: 'Inicia sesión para usar Calili.' }, { status: 401 });
  }
  try {
    const formData = await req.formData();
    const files = formData.getAll('files').filter((value): value is File => value instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: 'Selecciona al menos un archivo.' }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Máximo ${MAX_FILES} archivos por envío.` }, { status: 413 });
    }
    if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_BYTES) {
      return NextResponse.json({ error: 'El conjunto supera el límite de 25 MB.' }, { status: 413 });
    }

    const attachments = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        attachments.push({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, text: '', analyzableImage: false, error: 'Supera el límite de 10 MB.' });
        continue;
      }

      try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const extension = file.name.split('.').pop()?.toLowerCase();
      let text = '';

      if (file.type === 'application/pdf' || extension === 'pdf') {
        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        const parsed = await extractText(pdf, { mergePages: true });
        text = trimExtractedText(String(parsed.text));
      } else if (
        file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        extension === 'xlsx'
      ) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
        const sheets: string[] = [];
        workbook.eachSheet((sheet) => {
          const rows: string[] = [];
          sheet.eachRow((row) => {
            const values = (row.values as unknown[]).slice(1).map((v) => {
              if (v === null || v === undefined) return '';
              if (v instanceof Date) return v.toISOString().slice(0, 10);
              if (typeof v === 'object') {
                const obj = v as { text?: string; result?: unknown };
                return String(obj.text ?? obj.result ?? '');
              }
              return String(v);
            });
            rows.push(values.join(' | '));
          });
          sheets.push(`HOJA: ${sheet.name}\n${rows.join('\n')}`);
        });
        text = trimExtractedText(sheets.join('\n\n'));
      } else if (
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        extension === 'docx'
      ) {
        const parsed = await mammoth.extractRawText({ buffer });
        text = trimExtractedText(parsed.value);
      } else if (
        file.type.startsWith('text/') ||
        ['txt', 'md', 'csv', 'json', 'xml', 'html'].includes(extension ?? '')
      ) {
        text = trimExtractedText(buffer.toString('utf8'));
      }

      attachments.push({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        text,
        analyzableImage: file.type.startsWith('image/'),
      });
      } catch {
        attachments.push({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, text: '', analyzableImage: false, error: 'No se pudo leer este archivo (puede estar dañado).' });
      }
    }

    return NextResponse.json({ ok: true, attachments });
  } catch (error) {
    console.error('Error al analizar archivos:', error);
    return NextResponse.json(
      { error: 'No se pudieron analizar los archivos.' },
      { status: 500 }
    );
  }
}
