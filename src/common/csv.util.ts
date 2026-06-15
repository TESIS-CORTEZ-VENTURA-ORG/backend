// Parser CSV puro (RFC 4180): comillas, comillas escapadas (""), comas y saltos
// de línea embebidos, y CRLF. Sin dependencias → unit-testeable (HU-02-02).

export interface CsvRecord {
  /** Línea física (1-based) donde empieza el registro — para reportes "línea exacta". */
  line: number;
  cells: string[];
}

export function parseCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let field = '';
  let cells: string[] = [];
  let inQuotes = false;
  let line = 1;
  let started = false; // ¿el registro actual ya tiene contenido?
  let startLine = 1;

  const begin = (): void => {
    if (!started) {
      started = true;
      startLine = line;
    }
  };
  const endRecord = (): void => {
    cells.push(field);
    field = '';
    const isBlank = cells.length === 1 && cells[0].trim() === '';
    if (!isBlank) {
      records.push({ line: startLine, cells });
    }
    cells = [];
    started = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === '\n') {
          line += 1;
        }
        field += c;
      }
      continue;
    }
    if (c === '"') {
      begin();
      inQuotes = true;
    } else if (c === ',') {
      begin();
      cells.push(field);
      field = '';
    } else if (c === '\r') {
      // ignorado; el salto lo marca \n
    } else if (c === '\n') {
      if (started || field.length > 0 || cells.length > 0) {
        endRecord();
      }
      line += 1;
    } else {
      begin();
      field += c;
    }
  }
  if (started || field.length > 0 || cells.length > 0) {
    endRecord();
  }
  return records;
}
