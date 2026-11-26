import { describe, expect, it } from 'vitest';
import { otmaResponsibleNow } from '../src/lib/otma';

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
