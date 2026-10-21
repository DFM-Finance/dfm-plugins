import type {
  Action,
  ActionResult,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  JSONSchema,
  Memory,
  ModelType,
  Plugin,
  State,
} from '@elizaos/core';
import {
  DfmMcpBridge,
  DFM_RISK_NOTE,
  DFM_SECURITY_NOTE,
  type DfmBridgeOptions,
  type DfmTool,
} from '@dfm-fi/mcp-bridge';

export { DFM_SECURITY_NOTE, DFM_RISK_NOTE } from '@dfm-fi/mcp-bridge';

/** Settings read from the character / runtime and passed to the DFM server. */
export const DFM_SETTING_KEYS = [
  'DFM_API_KEY',
  'DFM_API_URL',
  'DFM_RPC_URL',
  'DFM_AGENT_WRITE_ENABLED',
  'DFM_AGENT_KEYPAIR_PATH',
  'DFM_MCP_CONFIRM_REQUIRED',
  'DFM_MCP_NONINTERACTIVE_WRITES',
] as const;

const OBJECT_SMALL: typeof ModelType.OBJECT_SMALL = 'OBJECT_SMALL';

export interface DfmElizaPluginOptions extends DfmBridgeOptions {
  /** Use an existing bridge instead of spawning a new server. */
  bridge?: DfmMcpBridge;
  /** Prefix for Eliza action names. Default `DFM_`. */
  actionPrefix?: string;
}

export function elizaActionName(toolName: string, prefix = 'DFM_'): string {
  return `${prefix}${toolName.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
}

function hasParams(tool: DfmTool): boolean {
  return Object.keys(tool.inputSchema.properties ?? {}).length > 0;
}

function recentText(message: Memory, state?: State): string {
  const parts: string[] = [];
  const stateText = typeof state?.text === 'string' ? state.text : '';
  if (stateText) parts.push(stateText.slice(-4000));
  const msg = typeof message.content?.text === 'string' ? message.content.text : '';
  if (msg) parts.push(`Latest message: ${msg}`);
  return parts.join('\n\n');
}

/** Prompt for extracting a tool's arguments from the conversation. */
export function buildArgsPrompt(tool: DfmTool, conversation: string): string {
  return [
    `Extract the arguments for the DFM tool "${tool.name}" from the conversation below.`,
    `Tool description: ${tool.description}`,
    `Return one JSON object that matches this JSON Schema: ${JSON.stringify(tool.inputSchema)}`,
    'Use only values the user actually gave or that are unambiguous from context.',
    'Omit optional fields you do not know. Never invent wallet addresses, amounts or private keys.',
    '',
    conversation,
  ].join('\n');
}

/**
 * Resolve the tool arguments: explicit `options.parameters` first, else ask the
 * model for an object that matches the tool's schema.
 */
export async function resolveArgs(
  tool: DfmTool,
  runtime: IAgentRuntime,
  message: Memory,
  state?: State,
  options?: HandlerOptions,
): Promise<Record<string, unknown>> {
  const given = options?.parameters;
  if (given && typeof given === 'object' && !Array.isArray(given)) {
    return given as Record<string, unknown>;
  }
  if (!hasParams(tool)) return {};
  const generated = await runtime.useModel(OBJECT_SMALL, {
    prompt: buildArgsPrompt(tool, recentText(message, state)),
    schema: tool.inputSchema as unknown as JSONSchema,
    output: 'object',
    temperature: 0,
  });
  return generated && typeof generated === 'object' ? (generated as Record<string, unknown>) : {};
}

/** Turn one MCP tool into an Eliza action. */
export function toolToElizaAction(tool: DfmTool, bridge: DfmMcpBridge, prefix = 'DFM_'): Action {
  const name = elizaActionName(tool.name, prefix);
  const words = tool.name.replace(/_/g, ' ');
  return {
    name,
    similes: [tool.name.toUpperCase(), `DFM ${words}`.toUpperCase()],
    description: `${tool.description}\n\n(DFM MCP tool \`${tool.name}\`.)`,
    examples: [],
    validate: async () => true,
    handler: async (
      runtime: IAgentRuntime,
      message: Memory,
      state?: State,
      options?: HandlerOptions,
      callback?: HandlerCallback,
    ): Promise<ActionResult> => {
      let args: Record<string, unknown>;
      try {
        args = await resolveArgs(tool, runtime, message, state, options);
      } catch (err) {
        const text = `Could not work out the arguments for ${tool.name}: ${(err as Error).message}`;
        await callback?.({ text, actions: [name], source: message.content?.source });
        return { success: false, text, error: text };
      }
      const parsed = tool.zodSchema.safeParse(args);
      if (!parsed.success) {
        const missing = parsed.error.issues
          .map((i) => `${i.path.join('.') || '(input)'}: ${i.message}`)
          .join('; ');
        const text = `I need more details for ${tool.name}: ${missing}`;
        await callback?.({ text, actions: [name], source: message.content?.source });
        return { success: false, text, error: text };
      }
      const res = await bridge.callTool(tool.name, parsed.data as Record<string, unknown>);
      await callback?.({ text: res.text, actions: [name], source: message.content?.source });
      return {
        success: !res.isError,
        text: res.text,
        values: { dfmTool: tool.name },
        data: res.data !== undefined ? { result: res.data } : undefined,
        ...(res.isError ? { error: res.text } : {}),
      };
    },
  };
}

function settingsFrom(runtime: IAgentRuntime, config: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of DFM_SETTING_KEYS) {
    const fromConfig = config?.[key];
    const fromRuntime = runtime.getSetting(key);
    const value = fromConfig ?? (fromRuntime === null || fromRuntime === undefined ? undefined : String(fromRuntime));
    if (value !== undefined && value !== '') env[key] = value;
  }
  return env;
}

/**
 * Create the DFM plugin for ElizaOS 1.x. At `init` it starts DFM's MCP server,
 * lists its tools and registers one action per tool.
 */
export function createDfmElizaPlugin(options: DfmElizaPluginOptions = {}): Plugin & { bridge(): DfmMcpBridge | null } {
  const { bridge: given, actionPrefix = 'DFM_', ...bridgeOptions } = options;
  let bridge: DfmMcpBridge | null = given ?? null;
  return {
    name: 'dfm',
    description: `DFM: DTF vaults on Solana through DFM's MCP server. ${DFM_SECURITY_NOTE} ${DFM_RISK_NOTE}`,
    bridge: () => bridge,
    init: async (config: Record<string, string>, runtime: IAgentRuntime) => {
      if (!bridge) {
        bridge = new DfmMcpBridge({
          clientName: 'dfm-plugin-eliza',
          ...bridgeOptions,
          env: { ...settingsFrom(runtime, config ?? {}), ...(bridgeOptions.env ?? {}) },
        });
      }
      const tools = await bridge.listTools();
      for (const tool of tools) runtime.registerAction(toolToElizaAction(tool, bridge, actionPrefix));
    },
    actions: [],
  };
}

/** Ready-to-use plugin with default options. */
export const dfmPlugin = createDfmElizaPlugin();

export default dfmPlugin;
