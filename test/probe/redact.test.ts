import { describe, expect, it } from 'vitest';
import { REDACTED, redactBody, redactCookieHeader, redactHeaders, redactJson, redactSetCookie, redactUrl, scrubLine } from '../../tools/probe/src/redact.ts';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJfaWQiOiI2OWUwMjA3NGUzMDlkNTBmNzQ5YmM0ZjMifQ.c2lnbmF0dXJlc2lnbmF0dXJl';

describe('redactHeaders', () => {
  it('schwärzt Auth-Header und behält harmlose', () => {
    const out = redactHeaders({
      Authorization: `Bearer ${JWT}`,
      'milanote-com-permission-tokens': 'abc',
      'x-amz-security-token': 'xyz',
      'content-type': 'application/json',
      'x-amzn-waf-action': 'challenge',
    });
    expect(out.Authorization).toBe(REDACTED);
    expect(out['milanote-com-permission-tokens']).toBe(REDACTED);
    expect(out['x-amz-security-token']).toBe(REDACTED);
    expect(out['content-type']).toBe('application/json');
    expect(out['x-amzn-waf-action']).toBe('challenge');
  });

  it('behält Cookie-Namen, schwärzt Werte', () => {
    expect(redactCookieHeader('better-auth.session_token=abc.def; aws-waf-token=123')).toBe(
      'better-auth.session_token=REDACTED; aws-waf-token=REDACTED',
    );
    expect(redactSetCookie('sid=secret; Path=/; HttpOnly; Secure')).toBe('sid=REDACTED; Path=/; HttpOnly; Secure');
  });
});

describe('redactUrl', () => {
  it('schwärzt S3-Signaturen und Share-Link-IDs, behält Pfad und harmlose Parameter', () => {
    const presigned =
      'https://milanote-media.s3.amazonaws.com/p/abc/image.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA%2F20261020&X-Amz-Date=20261020T120000Z&X-Amz-Expires=900&X-Amz-Signature=deadbeef&X-Amz-Security-Token=tok';
    const out = redactUrl(presigned);
    expect(out).toContain('/p/abc/image.png');
    expect(out).toContain('X-Amz-Expires=900');
    expect(out).not.toContain('deadbeef');
    expect(out).not.toContain('AKIA');
    expect(out).not.toContain('=tok');
    expect(redactUrl('https://app.milanote.com/1WSyYg10kflR5v/board?p=perm123')).toBe('https://app.milanote.com/1WSyYg10kflR5v/board?p=REDACTED');
    expect(redactUrl('https://app.milanote.com/api/boards?ids=1WSyYg10kflR5v&tokens=abc')).toBe(
      'https://app.milanote.com/api/boards?ids=1WSyYg10kflR5v&tokens=REDACTED',
    );
  });
});

describe('redactJson', () => {
  it('schwärzt Tokens, Passwörter und E-Mails rekursiv', () => {
    const out = redactJson({
      user: { _id: '69e02074e309d50f749bc4f3', email: 'jemand@example.com', name: { displayName: 'Test' } },
      tokens: ['a', 'b'],
      token: JWT,
      password: 'pw',
      note: `Kontakt: jemand@example.com, Token ${JWT}`,
      presignedUrl: 'https://bucket.s3.amazonaws.com/x?X-Amz-Signature=abc',
      permissionId: 'perm',
      empty: null,
    }) as Record<string, unknown>;
    expect((out.user as Record<string, unknown>)._id).toBe('69e02074e309d50f749bc4f3');
    expect((out.user as Record<string, unknown>).email).toBe(REDACTED);
    expect(out.tokens).toEqual([REDACTED, REDACTED]);
    expect(out.token).toBe(REDACTED);
    expect(out.password).toBe(REDACTED);
    expect(out.note).toBe(`Kontakt: ${REDACTED}, Token ${REDACTED}`);
    expect(out.presignedUrl).toBe('https://bucket.s3.amazonaws.com/x?X-Amz-Signature=REDACTED');
    expect(out.permissionId).toBe(REDACTED);
    expect(out.empty).toBeNull();
  });
});

describe('redactBody', () => {
  it('versteht Socket.IO-Frames mit Ack-ID', () => {
    const frame = `421["action",{"type":"ELEMENT_CREATE","tokens":["${JWT}"],"id":"1XbZEqlawr6y03"}]`;
    const out = redactBody(frame);
    expect(out.startsWith('421[')).toBe(true);
    expect(out).toContain('"type":"ELEMENT_CREATE"');
    expect(out).toContain('"tokens":["REDACTED"]');
    expect(out).not.toContain(JWT);
  });

  it('versteht Engine.IO-Open-Paket und Acks', () => {
    expect(redactBody('0{"sid":"abc","pingInterval":25000}')).toBe('0{"sid":"abc","pingInterval":25000}');
    expect(redactBody('431[{"status":200}]')).toBe('431[{"status":200}]');
  });

  it('schwärzt Formular-Bodies', () => {
    expect(redactBody('email=a%40b.de&password=geheim&remember=1', 'application/x-www-form-urlencoded')).toBe(
      'email=REDACTED&password=REDACTED&remember=1',
    );
  });

  it('lässt Freitext durch, schwärzt aber eingebettete Geheimnisse', () => {
    expect(redactBody(`Bearer ${JWT}`)).toBe(`Bearer ${REDACTED}`);
  });
});

describe('scrubLine', () => {
  it('fängt übersehene Signaturen und JWTs auf Zeilenebene', () => {
    const line = `{"x":"X-Amz-Signature=abc123&y=1","j":"${JWT}"}`;
    expect(scrubLine(line)).toBe('{"x":"X-Amz-Signature=REDACTED&y=1","j":"REDACTED"}');
  });
});
