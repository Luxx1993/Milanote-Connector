// Fehler mit Code und einer Meldung, die Claude (und Menschen) direkt verstehen und befolgen können.

export type MilanoteErrorCode = 'browser' | 'auth' | 'not_found' | 'http' | 'rejected' | 'connection' | 'args';

export class MilanoteError extends Error {
  constructor(
    readonly code: MilanoteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MilanoteError';
  }
}
