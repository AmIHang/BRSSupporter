import { describe, expect, it } from 'vitest';
import { customerColor, defaultColor, textOn } from '../src/lib/colors';

describe('customer colors', () => {
  it('computes a stable, valid color that differs between customers', () => {
    const a = defaultColor('ELL Austria GmbH');
    expect(a).toMatch(/^#[0-9a-f]{6}$/);
    expect(defaultColor('ELL Austria GmbH')).toBe(a);
    const names = ['Boom Software AG', 'ELL Austria GmbH', 'Flix SE', 'EUCO Rail AG', 'CFL'];
    expect(new Set(names.map(defaultColor)).size).toBe(names.length);
  });

  it('prefers the chosen color, none without customer', () => {
    expect(customerColor({ customer: 'X', customerColor: '#123456' })).toBe('#123456');
    expect(customerColor({ customer: 'X', customerColor: null })).toBe(defaultColor('X'));
    expect(customerColor({ customer: null, customerColor: null })).toBeNull();
  });

  it('picks readable text', () => {
    expect(textOn('#ffffff')).toBe('#1f2328');
    expect(textOn('#ffeb3b')).toBe('#1f2328');
    expect(textOn('#000000')).toBe('#ffffff');
    expect(textOn('#1b3a5c')).toBe('#ffffff');
  });
});
