import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.util';

describe('parseCsv (HU-02-02)', () => {
  it('parsea cabecera + filas con número de línea físico', () => {
    const recs = parseCsv('sku,name\nA1,Carne\nB2,Cebolla');
    expect(recs).toHaveLength(3);
    expect(recs[0].cells).toEqual(['sku', 'name']);
    expect(recs[1]).toEqual({ line: 2, cells: ['A1', 'Carne'] });
    expect(recs[2]).toEqual({ line: 3, cells: ['B2', 'Cebolla'] });
  });

  it('soporta comillas, comas y comillas escapadas dentro del campo', () => {
    const recs = parseCsv('sku,name\nA1,"Carne, de res ""premium"""');
    expect(recs[1].cells).toEqual(['A1', 'Carne, de res "premium"']);
  });

  it('maneja CRLF y salta líneas en blanco sin desfasar el contador', () => {
    const recs = parseCsv('sku\r\nA1\r\n\r\nB2\r\n');
    expect(recs.map((r) => r.cells[0])).toEqual(['sku', 'A1', 'B2']);
    // B2 está en la línea física 4 (tras la línea en blanco 3).
    expect(recs[2].line).toBe(4);
  });

  it('respeta saltos de línea embebidos en campos entre comillas', () => {
    const recs = parseCsv('sku,name\nA1,"línea1\nlínea2"\nB2,otro');
    expect(recs).toHaveLength(3);
    expect(recs[1].cells[1]).toBe('línea1\nlínea2');
    // El registro siguiente arranca en la línea física 4.
    expect(recs[2].line).toBe(4);
  });
});
