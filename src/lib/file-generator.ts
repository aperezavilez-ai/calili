import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

// Generador de archivos reales para la herramienta crear_archivo.
// Formatos: docx, xlsx, pdf, csv, md, txt. El contenido de texto se
// interpreta como Markdown sencillo (# títulos, - viñetas, | tablas |).

export type GeneratedFileFormat = 'docx' | 'xlsx' | 'pdf' | 'csv' | 'md' | 'txt';

export interface GeneratedFile {
  name: string;
  mime: string;
  base64: string;
}

const MIME: Record<GeneratedFileFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  csv: 'text/csv;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
};

function sanitizeName(name: string, format: GeneratedFileFormat): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase() || 'archivo-calili';
  return `${base}.${format}`;
}

function plainLines(markdown: string): string[] {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[Imagen]')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
}

// Extrae la primera tabla Markdown del contenido, si existe.
function extractTable(markdown: string): { columns: string[]; rows: string[][] } | null {
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i++) {
    const header = lines[i].trim();
    const delimiter = lines[i + 1].trim();
    if (header.startsWith('|') && /^\|[\s:|-]+\|$/.test(delimiter) && delimiter.includes('-')) {
      const split = (row: string) => row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const columns = split(header);
      const rows: string[][] = [];
      for (let j = i + 2; j < lines.length; j++) {
        const row = lines[j].trim();
        if (!row.startsWith('|')) break;
        rows.push(split(row));
      }
      if (columns.length > 0) return { columns, rows };
    }
  }
  return null;
}

function toCsv(columns: string[] | null, rows: string[][], fallbackText: string): string {
  const escape = (cell: string) => (/[",\n;]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  if (columns || rows.length) {
    const all = columns ? [columns, ...rows] : rows;
    return all.map((row) => row.map((c) => escape(String(c ?? ''))).join(',')).join('\r\n');
  }
  return fallbackText
    .split(/\r?\n/)
    .map((line) => escape(line.replace(/^[#\-* ]+/, '')))
    .join('\r\n');
}

async function createDocx(title: string, content: string): Promise<Buffer> {
  const children: Paragraph[] = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })];
  for (const line of plainLines(content)) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (heading) {
      const level = heading[1].length === 1 ? HeadingLevel.HEADING_1 : heading[1].length === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      children.push(new Paragraph({ text: heading[2], heading: level }));
    } else {
      children.push(new Paragraph({ children: [new TextRun(line || ' ')] }));
    }
  }
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

async function createPdf(title: string, content: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(20).font('Helvetica-Bold').text(title);
    doc.moveDown(0.5);
    for (const line of plainLines(content)) {
      const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
      if (heading) {
        doc.moveDown(0.6).fontSize(heading[1].length === 1 ? 16 : 13).font('Helvetica-Bold').text(heading[2]);
        doc.font('Helvetica').fontSize(10.5);
      } else {
        doc.font('Helvetica').fontSize(10.5).text(line || ' ', { lineGap: 3 });
      }
    }
    doc.end();
  });
}

async function createXlsx(
  title: string,
  table: { columns: string[]; rows: string[][] } | null,
  content: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Datos');
  const data = table ?? { columns: [], rows: plainLines(content).filter(Boolean).map((l) => [l]) };
  if (data.columns.length) {
    sheet.addRow(data.columns);
    sheet.getRow(1).font = { bold: true };
  }
  for (const row of data.rows) sheet.addRow(row);
  sheet.columns.forEach((column) => {
    let max = 10;
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      max = Math.max(max, Math.min(60, String(cell.value ?? '').length + 2));
    });
    column.width = max;
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

export interface CreateFileArgs {
  formato: GeneratedFileFormat;
  nombre: string;
  titulo?: string;
  contenido: string;
  columnas?: string[];
  filas?: string[][];
}

export async function generateFile(args: CreateFileArgs): Promise<GeneratedFile> {
  const format = args.formato;
  const title = args.titulo?.trim() || args.nombre;
  const content = args.contenido ?? '';
  const explicitTable = args.columnas || args.filas
    ? { columns: args.columnas ?? [], rows: args.filas ?? [] }
    : null;
  const table = explicitTable ?? extractTable(content);

  let buffer: Buffer;
  switch (format) {
    case 'docx':
      buffer = await createDocx(title, content);
      break;
    case 'pdf':
      buffer = await createPdf(title, content);
      break;
    case 'xlsx':
      buffer = await createXlsx(title, table, content);
      break;
    case 'csv':
      buffer = Buffer.from(toCsv(table?.columns ?? null, table?.rows ?? [], content), 'utf-8');
      break;
    case 'md':
      buffer = Buffer.from(`# ${title}\n\n${content}\n`, 'utf-8');
      break;
    case 'txt':
      buffer = Buffer.from(plainLines(content).join('\n'), 'utf-8');
      break;
  }

  return { name: sanitizeName(args.nombre, format), mime: MIME[format], base64: buffer.toString('base64') };
}
