import { describe, expect, it } from 'vitest';
import { isWorkingHours } from '../src/working-hours.js';

describe('isWorkingHours', () => {
  it('is Mon–Fri 7:00–18:59 local time', () => {
    // 2026-11-18 is a Wednesday, 2026-11-21 a Saturday (local time, no zone suffix).
    expect(isWorkingHours(new Date('2026-11-18T07:00:00'))).toBe(true);
    expect(isWorkingHours(new Date('2026-11-18T18:59:00'))).toBe(true);
    expect(isWorkingHours(new Date('2026-11-18T06:59:00'))).toBe(false);
    expect(isWorkingHours(new Date('2026-11-18T19:00:00'))).toBe(false);
    expect(isWorkingHours(new Date('2026-11-21T10:00:00'))).toBe(false);
    expect(isWorkingHours(new Date('2026-11-23T10:00:00'))).toBe(true);
  });
});
