// MCP-Server (stdio). Phase 1 enthält nur `whoami` als Durchstich; die übrigen Tools folgen ab Phase 2.
// Alles, was an stdout geht, ist MCP-Protokoll. Logs daher nur nach stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MilanoteClient } from './milanote.ts';
import { MilanoteError } from './errors.ts';

const port = Number(process.env.MILANOTE_CDP_PORT ?? 9222);
const log = (message: string) => process.stderr.write(`[milanote] ${message}\n`);

let client: Promise<MilanoteClient> | undefined;

/** Verbindet beim ersten Tool-Aufruf und danach erneut, falls der Browser zwischenzeitlich weg war. */
function getClient(): Promise<MilanoteClient> {
  client ??= MilanoteClient.connect({ port, log }).catch((error: unknown) => {
    client = undefined;
    throw error;
  });
  return client;
}

function resetClient(): void {
  const old = client;
  client = undefined;
  void old?.then((c) => c.close()).catch(() => undefined);
}

function errorResult(error: unknown) {
  const text = error instanceof MilanoteError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: 'text' as const, text }] };
}

const server = new McpServer({ name: 'milanote', version: '0.1.0' });

server.registerTool(
  'whoami',
  {
    title: 'Milanote: angemeldeter Nutzer',
    description: 'Zeigt, wer im Debug-Chrome bei Milanote angemeldet ist, und die ID des Home-Boards.',
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      const user = await (await getClient()).whoami();
      return { content: [{ type: 'text', text: JSON.stringify(user, null, 2) }] };
    } catch (error) {
      // Bei Verbindungs- oder Anmeldefehlern beim nächsten Aufruf frisch verbinden.
      if (error instanceof MilanoteError && error.code !== 'args') resetClient();
      return errorResult(error);
    }
  },
);

await server.connect(new StdioServerTransport());
log(`bereit (CDP-Port ${port})`);
