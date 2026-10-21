import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { z } from 'zod';
import { toolInputToZod, type JsonSchema } from './schema.js';

/** Version of this bridge; sent to the server as the MCP client version. */
export const BRIDGE_VERSION = '0.1.0';

export interface DfmBridgeOptions {
  /** Command that starts the server. Default `npx`. */
  command?: string;
  /** Arguments. Default `['-y', '@dfm-fi/agent@latest']`. */
  args?: string[];
  /**
   * Extra DFM_* settings for the server (for example DFM_API_KEY,
   * DFM_AGENT_WRITE_ENABLED). Keys that do not start with `DFM_` are dropped.
   * Merged over the DFM_* variables already in `process.env`.
   */
  env?: Record<string, string | undefined>;
  /** Read DFM_* variables from `process.env`. Default true. */
  inheritProcessEnv?: boolean;
  /** Client name reported to the server. */
  clientName?: string;
  /** Working directory for the server process. */
  cwd?: string;
}

export interface DfmTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  /** zod (v3 API) version of `inputSchema`. */
  zodSchema: z.ZodTypeAny;
  /** MCP annotations, for example `readOnlyHint`. */
  annotations?: Record<string, unknown>;
}

export interface DfmToolResult {
  /** All text content blocks joined with a newline. */
  text: string;
  /** `structuredContent`, or the text parsed as JSON when it is JSON. */
  data?: unknown;
  /** True when the server reported a tool error. */
  isError: boolean;
  /** The raw MCP content blocks. */
  content: unknown[];
}

/**
 * Variables that must never be forwarded, even though they start with DFM_.
 * The plugins pass key *paths* through (the server reads the file itself) but
 * never key *material*.
 */
const FORBIDDEN_ENV = /(PRIVATE_KEY|SECRET_KEY|SEED|MNEMONIC|KEYPAIR_JSON|KEYPAIR_BASE58|KEYPAIR_B58)/i;

/**
 * Build the child environment: PATH and HOME plus the DFM_* variables the user
 * set. Nothing else from the parent environment is copied by this function.
 * (The MCP SDK additionally adds its own non-secret defaults: on POSIX
 * HOME, LOGNAME, PATH, SHELL, TERM, USER.)
 */
export function buildServerEnv(options: DfmBridgeOptions = {}): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.PATH) env.PATH = process.env.PATH;
  if (process.env.HOME) env.HOME = process.env.HOME;
  const sources: Array<Record<string, string | undefined>> = [];
  if (options.inheritProcessEnv !== false) sources.push(process.env);
  if (options.env) sources.push(options.env);
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (!key.startsWith('DFM_') || FORBIDDEN_ENV.test(key)) continue;
      if (value === undefined || value === '') {
        delete env[key];
        continue;
      }
      env[key] = String(value);
    }
  }
  return env;
}

function parseMaybeJson(text: string): unknown {
  const t = text.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/**
 * A connection to DFM's MCP server (`@dfm-fi/agent`) over stdio.
 * The server is read-only unless DFM_AGENT_WRITE_ENABLED=true is set by the user.
 */
export class DfmMcpBridge {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: DfmTool[] | null = null;
  private connecting: Promise<void> | null = null;

  constructor(private readonly options: DfmBridgeOptions = {}) {}

  get connected(): boolean {
    return this.client !== null;
  }

  async connect(): Promise<void> {
    if (this.client) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const transport = new StdioClientTransport({
        command: this.options.command ?? 'npx',
        args: this.options.args ?? ['-y', '@dfm-fi/agent@latest'],
        env: buildServerEnv(this.options),
        cwd: this.options.cwd,
        // The server's own logs are not echoed: they could contain account data.
        stderr: 'ignore',
      });
      const client = new Client(
        { name: this.options.clientName ?? 'dfm-mcp-bridge', version: BRIDGE_VERSION },
        { capabilities: {} },
      );
      try {
        await client.connect(transport);
      } catch (err) {
        await transport.close().catch(() => undefined);
        throw new Error(`DFM MCP server failed to start: ${(err as Error).message}`);
      }
      this.client = client;
      this.transport = transport;
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  /** List every tool the server exposes (cached after the first call). */
  async listTools(refresh = false): Promise<DfmTool[]> {
    if (this.tools && !refresh) return this.tools;
    await this.connect();
    const out: DfmTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.client!.listTools(cursor ? { cursor } : {});
      for (const t of page.tools) {
        const inputSchema = (t.inputSchema ?? { type: 'object' }) as JsonSchema;
        out.push({
          name: t.name,
          title: t.title,
          description: t.description ?? t.title ?? t.name,
          inputSchema,
          zodSchema: toolInputToZod(inputSchema),
          annotations: t.annotations as Record<string, unknown> | undefined,
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
    this.tools = out;
    return out;
  }

  /** Call a tool by name. Never throws on a tool-level error; check `isError`. */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<DfmToolResult> {
    await this.connect();
    const res = await this.client!.callTool({ name, arguments: args });
    const content = Array.isArray(res.content) ? (res.content as unknown[]) : [];
    const text = content
      .filter((c): c is { type: 'text'; text: string } =>
        !!c && typeof c === 'object' && (c as { type?: unknown }).type === 'text',
      )
      .map((c) => c.text)
      .join('\n');
    const data = res.structuredContent ?? parseMaybeJson(text);
    return { text, data, isError: res.isError === true, content };
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.transport = null;
    this.tools = null;
    if (client) await client.close().catch(() => undefined);
  }
}
