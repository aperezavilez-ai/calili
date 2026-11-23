// Reparación de tablas Markdown mal formadas que a veces emite el modelo.
//
// Causa raíz del defecto visible en producción (captura de Luis, 2026-11-23):
// remark-gfm NO reconoce una tabla si la fila de encabezado viene pegada al
// párrafo anterior sin línea en blanco (la tabla no puede «interrumpir» un
// párrafo), ni si la fila delimitadora (|---|---|) viene pegada a otra fila
// en la misma línea. En ambos casos la tabla se renderiza como texto crudo
// con los caracteres | visibles.
//
// Esta función normaliza el texto antes de renderizarlo:
//   1. Inserta una línea en blanco antes de un encabezado de tabla pegado.
//   2. Despega la fila delimitadora cuando viene en la misma línea que el
//      encabezado y/o que las filas de datos, reagrupando las celdas.

const DELIMITER_CELL = String.raw`\s*:?-{2,}:?\s*`;
const DELIMITER_RE = new RegExp(
  String.raw`\|(?:${DELIMITER_CELL}\|)+`,
);

function isDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') || !/-{2,}/.test(trimmed)) return false;
  return /^\|?[\s:|-]+$/.test(trimmed) && trimmed.split('|').every((cell) => {
    const c = cell.trim();
    return c === '' || /^:?-{2,}:?$/.test(c);
  });
}

function isRowLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2;
}

function countCells(rowOrDelimiter: string): number {
  return rowOrDelimiter.split('|').filter((cell, index, arr) => {
    // Descartar los vacíos de los extremos por los | inicial/final.
    if (index === 0 || index === arr.length - 1) return cell.trim() !== '';
    return true;
  }).length;
}

function splitCells(text: string): string[] {
  const trimmed = text.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function toRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

// Si una línea trae la fila delimitadora pegada (al encabezado o a los
// datos), la separa en líneas de tabla bien formadas. Si no aplica,
// devuelve la línea intacta.
function unglueLine(line: string): string[] {
  if (isDelimiterLine(line) || !line.includes('|')) return [line];
  const match = line.match(DELIMITER_RE);
  if (!match || match.index === undefined) return [line];

  const delimiter = match[0];
  const before = line.slice(0, match.index).trim();
  const after = line.slice(match.index + delimiter.length).trim();

  // El número de columnas manda el encabezado si existe: el modelo a veces
  // emite un delimitador con menos celdas que el encabezado, y esa tabla
  // tampoco la reconoce GFM. Se regenera el delimitador con las columnas
  // correctas.
  const headerCells = before ? splitCells(before) : [];
  const columns = Math.max(countCells(delimiter), headerCells.length);
  if (columns === 0) return [line];

  const result: string[] = [];
  if (before) {
    while (headerCells.length < columns) headerCells.push('');
    result.push(toRow(headerCells));
  }
  result.push(toRow(Array.from({ length: columns }, () => '---')));

  if (after) {
    // Las celdas vacías aquí son el doble | que separa una fila de la
    // siguiente al venir todo pegado; se descartan para reagrupar bien.
    const cells = splitCells(after).filter((cell) => cell !== '');
    for (let i = 0; i < cells.length; i += columns) {
      const rowCells = cells.slice(i, i + columns);
      while (rowCells.length < columns) rowCells.push('');
      result.push(toRow(rowCells));
    }
  }
  return result;
}

export function fixMarkdownTables(text: string): string {
  // Los <br> literales que el modelo mete en las celdas se ven como texto
  // crudo (react-markdown no interpreta HTML): se convierten en espacios.
  const cleaned = text.replace(/<br\s*\/?>/gi, ' ');

  // Primero: despegar delimitadores pegados.
  const unglued: string[] = [];
  for (const line of cleaned.split('\n')) {
    unglued.push(...unglueLine(line));
  }

  // Filas sin | inicial justo después de un delimitador o de otra fila:
  // el modelo a veces las escribe como "1. Dato | Dato | Dato" y GFM no
  // las reconoce. Si el número de celdas coincide con el encabezado, se
  // envuelven como fila de tabla.
  const wrapped: string[] = [];
  let tableColumns = 0;
  for (let i = 0; i < unglued.length; i++) {
    const line = unglued[i];
    if (isDelimiterLine(line)) {
      tableColumns = countCells(line);
      wrapped.push(line);
      continue;
    }
    if (isRowLine(line)) {
      wrapped.push(line);
      continue;
    }
    if (tableColumns > 0 && line.includes('|')) {
      const cells = splitCells(line.replace(/^\d+[.)]\s*/, ''));
      if (cells.length === tableColumns) {
        wrapped.push(toRow(cells));
        continue;
      }
    }
    if (line.trim() === '') tableColumns = 0;
    wrapped.push(line);
  }

  // Segundo: línea en blanco antes de un encabezado pegado a un párrafo.
  const out: string[] = [];
  for (let i = 0; i < wrapped.length; i++) {
    const line = wrapped[i];
    const next = wrapped[i + 1];
    if (
      isRowLine(line) &&
      next !== undefined &&
      isDelimiterLine(next) &&
      out.length > 0
    ) {
      const prev = out[out.length - 1];
      if (prev.trim() !== '' && !isRowLine(prev) && !isDelimiterLine(prev)) {
        out.push('');
      }
    }
    out.push(line);
  }
  return out.join('\n');
}
