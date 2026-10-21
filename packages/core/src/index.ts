export { DfmMcpBridge, buildServerEnv, BRIDGE_VERSION } from './bridge.js';
export type { DfmBridgeOptions, DfmTool, DfmToolResult } from './bridge.js';
export { jsonSchemaToZod, toolInputToZod } from './schema.js';
export type { JsonSchema } from './schema.js';

/** Line every package README and plugin description carries. */
export const DFM_SECURITY_NOTE =
  'Read-only by default. Never asks for, reads or stores a private key or seed phrase in chat. ' +
  'Writes need DFM_AGENT_WRITE_ENABLED=true plus either a revocable dfm_ API key (an agent operating ' +
  "a human's account) or the agent's own identity keypair (a headless agent).";

export const DFM_RISK_NOTE = 'DFM runs on Solana mainnet. Deposits are real tokens and can lose value.';
