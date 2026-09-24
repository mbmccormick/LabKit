import { describe, expect, it } from 'vitest';
import { appleRedirectUrl, b64uDecode, b64uEncode, cardFileContents, cardFileName, fromNumeric, toNumeric, toPublicJwk } from '../src/shc';

describe('shc helpers', () => {
  it('base64url round-trips without padding', () => {
    const bytes = new Uint8Array([0, 251, 255, 1, 2]);
    const s = b64uEncode(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(b64uDecode(s)).toEqual(bytes);
  });

  it('numeric mode encodes charCode - 45 as two digits', () => {
    expect(toNumeric('-')).toBe('00');
    expect(toNumeric('.')).toBe('01');
    expect(toNumeric('e')).toBe('56');
    expect(toNumeric('eyJ')).toBe('567629');
    expect(fromNumeric(toNumeric('eyJ6aXAi.abc_-XYZ'))).toBe('eyJ6aXAi.abc_-XYZ');
  });

  it('redirect URL uses the Apple prefix', () => {
    expect(appleRedirectUrl('ab')).toBe('https://redirect.health.apple.com/SMARTHealthCard/#5253');
  });

  it('file contents and names', () => {
    expect(cardFileContents('x.y.z')).toBe('{"verifiableCredential":["x.y.z"]}');
    expect(cardFileName('2026-04-17')).toBe('labkit-2026-04-17.smart-health-card');
    expect(cardFileName('2026-04-17', 2)).toBe('labkit-2026-04-17-2.smart-health-card');
    expect(() => cardFileName('04/17/2026')).toThrow();
  });

  it('public JWK never carries d', () => {
    const pub = toPublicJwk({ x: 'X', y: 'Y', d: 'SECRET' } as never, 'kid');
    expect(pub).toEqual({ kty: 'EC', crv: 'P-256', x: 'X', y: 'Y', kid: 'kid', use: 'sig', alg: 'ES256' });
    expect(JSON.stringify(pub)).not.toContain('SECRET');
  });
});
