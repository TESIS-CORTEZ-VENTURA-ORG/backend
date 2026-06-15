// E07 · HU-07-10 · Serializador CSV PURO (sin dependencias) → testeable.
//
// Genera CSV conforme a RFC-4180: separador coma, fin de línea CRLF, una fila de
// cabeceras y una fila por registro. Un campo se entrecomilla SOLO si contiene
// coma, comilla doble o salto de línea; las comillas internas se duplican
// (`"` → `""`). La moneda/cantidad ya llega como string (mismas cifras que el JSON).

const CRLF = '\r\n';
// Caracteres que obligan a entrecomillar un campo (RFC-4180 §2.6/2.7).
const MUST_QUOTE = /["\n\r,]/;

/** Escapa un valor de celda según RFC-4180 (entrecomilla y duplica comillas). */
export function csvField(value: string | number): string {
  const str = String(value);
  if (!MUST_QUOTE.test(str)) {
    return str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Serializa filas a CSV RFC-4180. `headers` = columnas (primera fila) y, a la vez,
 * las claves a proyectar de cada registro (en ese orden). `T` no requiere index
 * signature: las claves se acotan a `keyof T`. Un valor `null`/`undefined` (o no
 * string/number) se emite como celda vacía. Termina sin CRLF final.
 */
export function toCsv<T>(
  headers: readonly (keyof T & string)[],
  rows: readonly T[],
): string {
  const headerLine = headers.map((h) => csvField(h)).join(',');
  const dataLines = rows.map((row) =>
    headers.map((h) => csvField(cellOf(row[h]))).join(','),
  );
  return [headerLine, ...dataLines].join(CRLF);
}

/** Normaliza un valor de campo a celda: string/number tal cual; el resto → ''. */
function cellOf(value: unknown): string | number {
  return typeof value === 'string' || typeof value === 'number' ? value : '';
}
