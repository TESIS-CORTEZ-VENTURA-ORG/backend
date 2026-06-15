import { describe, expect, it } from 'vitest';
import { csvField, toCsv } from './csv.util';

describe('csv.util — HU-07-10 (RFC-4180)', () => {
  it('no entrecomilla valores simples', () => {
    expect(csvField('Queso')).toBe('Queso');
    expect(csvField('40.00')).toBe('40.00');
    expect(csvField(7)).toBe('7');
  });

  it('entrecomilla campos con coma', () => {
    expect(csvField('Agua Mineral, fría')).toBe('"Agua Mineral, fría"');
  });

  it('entrecomilla y duplica las comillas internas', () => {
    expect(csvField('dice "hola"')).toBe('"dice ""hola"""');
  });

  it('entrecomilla campos con salto de línea', () => {
    expect(csvField('a\nb')).toBe('"a\nb"');
    expect(csvField('a\rb')).toBe('"a\rb"');
  });

  it('serializa con fila de cabeceras y CRLF entre filas', () => {
    const csv = toCsv(['name', 'qty'] as const, [
      { name: 'Queso', qty: '1.000' },
      { name: 'Tomate', qty: '3.000' },
    ]);
    expect(csv).toBe('name,qty\r\nQueso,1.000\r\nTomate,3.000');
    // Sin CRLF final.
    expect(csv.endsWith('\r\n')).toBe(false);
  });

  it('proyecta solo las columnas pedidas y celdas vacías para nulos', () => {
    const csv = toCsv(['a', 'b'] as const, [
      { a: 'x', b: null, c: 'ignorado' },
    ]);
    expect(csv).toBe('a,b\r\nx,');
  });

  it('una tabla sin filas devuelve solo la cabecera', () => {
    expect(toCsv(['a', 'b'] as const, [])).toBe('a,b');
  });
});
