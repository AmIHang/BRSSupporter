import { describe, expect, it } from 'vitest';
import { errorText } from '../src/bsm-edge.js';

describe('errorText', () => {
  it('drops Playwright call logs (they carry the session cookies)', () => {
    const err = new Error(
      'apiRequestContext.post: Request context disposed.\nCall log:\n  - → POST https://bsm/x\n' +
        '    - cookie: .ASPXAUTH=SECRET',
    );
    expect(errorText(err)).toBe('apiRequestContext.post: Request context disposed.');
    expect(errorText('plain')).toBe('plain');
  });
});
