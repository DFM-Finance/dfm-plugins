import type { Action, Plugin, SolanaAgentKit } from 'solana-agent-kit';
import {
  DfmMcpBridge,
  DFM_RISK_NOTE,
  DFM_SECURITY_NOTE,
  type DfmBridgeOptions,
  type DfmTool,
  type DfmToolResult,
} from '@dfm-fi/mcp-bridge';

export { DFM_SECURITY_NOTE, DFM_RISK_NOTE } from '@dfm-fi/mcp-bridge';

export interface DfmSakPluginOptions extends DfmBridgeOptions {
  /** Use an existing bridge instead of spawning a new server. */
  bridge?: DfmMcpBridge;
  /** Prefix for SAK action names. Default `DFM_` (list_dtfs -> DFM_LIST_DTFS). */
  actionPrefix?: string;
}

export interface DfmSakMethods {
  /** Call any DFM MCP tool by its MCP name. */
  dfmCallTool(name: string, args?: Record<string, unknown>): Promise<DfmToolResult>;
  /** The DFM tools this plugin exposes. */
  dfmListTools(): Promise<DfmTool[]>;
  /** Stop the DFM MCP server process. */
  dfmClose(): Promise<void>;
}

export type DfmSakPlugin = Plugin & { methods: DfmSakMethods; bridge: DfmMcpBridge };

export function sakActionName(toolName: string, prefix = 'DFM_'): string {
  return `${prefix}${toolName.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
}

/**
 * Turn one MCP tool into a SAK action. The handler ignores the agent argument
 * entirely: no wallet, key or connection from the SolanaAgentKit instance is
 * read or forwarded to DFM.
 */
export function toolToSakAction(tool: DfmTool, bridge: DfmMcpBridge, prefix = 'DFM_'): Action {
  const words = tool.name.replace(/_/g, ' ');
  const readOnly = tool.annotations?.readOnlyHint === true;
  return {
    name: sakActionName(tool.name, prefix),
    similes: [tool.name, `dfm ${words}`, words],
    description: `${tool.description}\n\n(DFM MCP tool \`${tool.name}\`${readOnly ? ', read-only' : ''}.)`,
    examples: [],
    schema: tool.zodSchema,
    handler: async (_agent: SolanaAgentKit, input: Record<string, any>) => {
      const res = await bridge.callTool(tool.name, input ?? {});
      return {
        status: res.isError ? 'error' : 'success',
        tool: tool.name,
        message: res.text,
        ...(res.data !== undefined ? { data: res.data } : {}),
      };
    },
  };
}

/**
 * Create the DFM plugin for Solana Agent Kit v2.
 *
 * SAK's `agent.use()` is synchronous and reads `plugin.actions` right away, so
 * the tool list is fetched here, before `use()`:
 *
 *   const dfm = await createDfmPlugin();
 *   const agent = new SolanaAgentKit(wallet, rpcUrl, {}).use(dfm);
 */
export async function createDfmPlugin(options: DfmSakPluginOptions = {}): Promise<DfmSakPlugin> {
  const { bridge: given, actionPrefix = 'DFM_', ...bridgeOptions } = options;
  const bridge = given ?? new DfmMcpBridge({ clientName: 'dfm-plugin-sak', ...bridgeOptions });
  const tools = await bridge.listTools();
  const actions = tools.map((t) => toolToSakAction(t, bridge, actionPrefix));
  const methods: DfmSakMethods = {
    dfmCallTool: (name, args = {}) => bridge.callTool(name, args),
    dfmListTools: () => bridge.listTools(),
    dfmClose: () => bridge.close(),
  };
  return {
    name: 'dfm',
    methods,
    actions,
    bridge,
    // Intentionally does nothing with the agent: DFM never needs its wallet.
    initialize(_agent: SolanaAgentKit): void {},
  };
}

/** Plugin description, for listings. */
export const DFM_SAK_PLUGIN_DESCRIPTION = `DFM on Solana Agent Kit. ${DFM_SECURITY_NOTE} ${DFM_RISK_NOTE}`;

export default createDfmPlugin;
