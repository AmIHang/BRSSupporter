import { describe, expect, it } from 'vitest';
import { otmaResponsibleNow, otmaResponsiblePerson, otmaStatusLabel } from '../src/lib/otma';

describe('otmaResponsiblePerson', () => {
  it('treats the support queue like nobody', () => {
    expect(otmaResponsiblePerson('BRS Support -')).toBeNull();
    expect(otmaResponsiblePerson('GRA -> BRS Support -')).toBeNull();
    expect(otmaResponsiblePerson(null)).toBeNull();
    expect(otmaResponsiblePerson('BRS Support - -> GAP')).toBe('GAP');
    expect(otmaResponsiblePerson('GRA')).toBe('GRA');
  });
});

describe('otmaStatusLabel', () => {
  it('groups the OTMA statuses, keeps unknown ones', () => {
    for (const s of ['Neu', 'Zugewiesen', 'Feedback', 'Bestätigt']) {
      expect(otmaStatusLabel(s)).toBe('In Arbeit');
    }
    expect(otmaStatusLabel('Abgearbeitet')).toBe('Abgearbeitet');
    expect(otmaStatusLabel('Freigegeben')).toBe('Freigegeben');
    expect(otmaStatusLabel('Geschlossen')).toBe('Erledigt');
    expect(otmaStatusLabel('Storniert')).toBe('Storniert');
  });
});

describe('otmaResponsibleNow', () => {
  it('takes the target of a handover', () => {
    expect(otmaResponsibleNow('HAM -> GRA')).toBe('GRA');
    expect(otmaResponsibleNow('HAM --> GRA')).toBe('GRA');
    expect(otmaResponsibleNow('BRS Support - -> GAP')).toBe('GAP');
  });
  it('keeps a plain responsible as is', () => {
    expect(otmaResponsibleNow('Erika Beispiel')).toBe('Erika Beispiel');
  });
});
