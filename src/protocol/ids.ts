// IDs wie die Web-App sie erzeugt (Format laut milanote-plus-plus, docs/protocol.md 4.4):
// Element-ID = base62(Unix-Sekunden) + clientId (6) + base62(clientTick % 3844), zweistellig.

import { randomInt } from 'node:crypto';

const A62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function base62(n: number): string {
  let value = Math.floor(n);
  if (value <= 0) return '0';
  let out = '';
  while (value > 0) {
    out = A62[value % 62] + out;
    value = Math.floor(value / 62);
  }
  return out;
}

export function random62(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += A62[randomInt(62)];
  return out;
}

function pad(value: string, length: number): string {
  return value.padStart(length, '0').slice(-length);
}

/** Erzeugt Element-, Versions-, Geräte- und Sitzungs-IDs für einen Client (eine Prozesslaufzeit). */
export class IdGenerator {
  readonly clientId: string;
  readonly sessionId: string;
  readonly deviceId: string;
  private tick = 1;
  private versionCounter = 0;

  constructor(private readonly now: () => number = Date.now) {
    const seconds = base62(Math.floor(now() / 1000));
    this.clientId = random62(6);
    this.sessionId = `msid-${seconds}${random62(4)}`;
    this.deviceId = `mdid-${seconds}${random62(4)}`;
  }

  get clientTick(): number {
    return this.tick;
  }

  elementId(): string {
    this.tick += 1;
    return `${base62(Math.floor(this.now() / 1000))}${this.clientId}${pad(base62(this.tick % 3844), 2)}`;
  }

  /** `versionId` für ein neues Element (`<Sitzung>-1`). */
  createVersionId(): string {
    return `${this.sessionId.slice(5)}-1`;
  }

  /** `versionId` für eine Änderung (fortlaufend je Sitzung). */
  nextVersionId(): string {
    this.versionCounter += 1;
    return `${this.sessionId.slice(5)}-${this.versionCounter}`;
  }

  /** Zufälliger 5-Zeichen-Schlüssel für TipTap-Blöcke. */
  blockKey(): string {
    return random62(5);
  }
}
