// Schwärzung für Mitschnitte. Alles, was das Probe-Skript auf die Platte schreibt, läuft hier durch.
// Grundsatz: lieber zu viel schwärzen als zu wenig. Namen (Header, Cookies, Query-Parameter, JSON-Keys)
// bleiben sichtbar, weil sie für die Protokollanalyse gebraucht werden; nur die Werte werden ersetzt.

export const REDACTED = 'REDACTED';

// Header, deren Wert immer geschwärzt wird.
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-amz-.+)$|token|secret|signature|credential|csrf|xsrf|api-?key|session/i;

// Query-Parameter mit Signaturen, Tokens oder Freigabe-IDs (`p` = permissionId aus Share-Links).
const SECRET_PARAM = /token|signature|credential|secret|session|auth|policy|key-pair-id|^key$|^p$|^code$|^state$/i;

// JSON-Keys, deren Wert geschwärzt wird (Wert egal welcher Typ).
const SECRET_KEY = /token|password|passwd|secret|signature|credential|cookie|authorization|captcha|^email$|^p$|permissionid/i;

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_IN_TEXT = /https?:\/\/[^\s"'<>\\]+/g;
// Letzte Sicherung auf Zeilenebene, falls ein Wert an der Strukturerkennung vorbeirutscht.
const AMZ_PARAM = /(X-Amz-(?:Signature|Credential|Security-Token)=)[^&"\s\\]+/gi;
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;

export function redactHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [name, raw] of Object.entries(headers)) {
    const value = String(raw ?? '');
    const lower = name.toLowerCase();
    if (lower === 'cookie') out[name] = redactCookieHeader(value);
    else if (lower === 'set-cookie') out[name] = value.split('\n').map(redactSetCookie).join('\n');
    else if (SECRET_HEADER.test(name)) out[name] = REDACTED;
    else out[name] = redactString(value);
  }
  return out;
}

// "a=1; b=2" -> "a=REDACTED; b=REDACTED" (Cookie-Namen bleiben lesbar)
export function redactCookieHeader(value: string): string {
  return value
    .split(';')
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;
      const eq = trimmed.indexOf('=');
      return eq < 0 ? REDACTED : `${trimmed.slice(0, eq)}=${REDACTED}`;
    })
    .join('; ');
}

// "name=value; Path=/; HttpOnly" -> "name=REDACTED; Path=/; HttpOnly"
export function redactSetCookie(line: string): string {
  const [first = '', ...attrs] = line.split(';');
  const eq = first.indexOf('=');
  const head = eq < 0 ? REDACTED : `${first.slice(0, eq).trim()}=${REDACTED}`;
  return [head, ...attrs.map((a) => a.trim())].join('; ');
}

export function redactUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.replace(JWT, REDACTED);
  }
  if (url.username || url.password) {
    url.username = REDACTED;
    url.password = '';
  }
  const params = [...url.searchParams.entries()];
  if (params.length) {
    const next = new URLSearchParams();
    for (const [name, value] of params) {
      next.append(name, SECRET_PARAM.test(name) ? REDACTED : value.replace(JWT, REDACTED).replace(EMAIL, REDACTED));
    }
    url.search = next.toString();
  }
  if (url.hash.length > 1) url.hash = REDACTED;
  return url.toString();
}

export function redactString(value: string): string {
  return value
    .replace(URL_IN_TEXT, (match) => redactUrl(match))
    .replace(JWT, REDACTED)
    .replace(EMAIL, REDACTED)
    .replace(BEARER, `$1${REDACTED}`);
}

export function redactJson(value: unknown, depth = 0): unknown {
  if (depth > 64) return '[zu tief verschachtelt]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactJson(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (SECRET_KEY.test(key) && inner !== null && inner !== undefined && inner !== '') {
        out[key] = Array.isArray(inner) ? inner.map(() => REDACTED) : REDACTED;
      } else {
        out[key] = redactJson(inner, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/**
 * Schwärzt einen Text-Body: JSON, Socket.IO-/Engine.IO-Frames (`42`, `431`, `0{…}`),
 * Formular-Kodierung oder Freitext. Gibt die geschwärzte Fassung als String zurück.
 */
export function redactBody(text: string, contentType = ''): string {
  const json = tryJson(text);
  if (json.ok) return JSON.stringify(redactJson(json.value));

  // Socket.IO über Engine.IO: Ziffern-Präfix (Pakettyp, optional Ack-ID), dann JSON.
  const frame = /^(\d+)([[{].*)$/s.exec(text);
  if (frame) {
    const inner = tryJson(frame[2] ?? '');
    if (inner.ok) return `${frame[1]}${JSON.stringify(redactJson(inner.value))}`;
  }

  if (/x-www-form-urlencoded/i.test(contentType) || /^[\w.%-]+=[^&\s]*(&[\w.%-]+=[^&\s]*)*$/.test(text)) {
    const params = new URLSearchParams(text);
    const next = new URLSearchParams();
    for (const [name, value] of params) next.append(name, SECRET_KEY.test(name) || SECRET_PARAM.test(name) ? REDACTED : redactString(value));
    return next.toString();
  }

  return redactString(text);
}

/** Letzte Sicherung, angewendet auf jede fertig serialisierte Zeile vor dem Schreiben. */
export function scrubLine(line: string): string {
  return line.replace(JWT, REDACTED).replace(AMZ_PARAM, `$1${REDACTED}`).replace(BEARER, `$1${REDACTED}`);
}

export function truncate(text: string, max: number): { text: string; truncated: boolean; length: number } {
  if (text.length <= max) return { text, truncated: false, length: text.length };
  return { text: text.slice(0, max), truncated: true, length: text.length };
}

function tryJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}
