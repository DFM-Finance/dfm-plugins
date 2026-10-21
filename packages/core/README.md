# @dfm-fi/mcp-bridge

Shared core of the DFM agent plugins. It starts DFM's MCP server ([`@dfm-fi/agent`](https://www.npmjs.com/package/@dfm-fi/agent)) over stdio, lists its tools, converts each tool's JSON Schema to zod and calls tools. [`@dfm-fi/plugin-sak`](../plugin-sak) and [`@dfm-fi/plugin-eliza`](../plugin-eliza) are thin adapters on top of it.

Read-only by default. Never asks for, reads or stores a private key or seed phrase in chat. Writes need DFM_AGENT_WRITE_ENABLED=true plus either a revocable dfm_ API key (an agent operating a human's account) or the agent's own identity keypair (a headless agent).

DFM runs on Solana mainnet. Deposits are real tokens and can lose value.

## Install

```sh
npm i @dfm-fi/mcp-bridge
```

## Use

```ts
import { DfmMcpBridge } from '@dfm-fi/mcp-bridge';

const dfm = new DfmMcpBridge();            // read-only unless DFM_AGENT_WRITE_ENABLED=true
const tools = await dfm.listTools();       // [{ name, description, inputSchema, zodSchema, annotations }]
const res = await dfm.callTool('list_dtfs', { limit: 5 });
console.log(res.text, res.data, res.isError);
await dfm.close();
```

Exports: `DfmMcpBridge` (`connect`, `listTools(refresh?)`, `callTool(name, args)`, `close`), `jsonSchemaToZod`, `toolInputToZod`, `buildServerEnv`, `DFM_SECURITY_NOTE`, `DFM_RISK_NOTE`.

Options: `command` / `args` (default `npx -y @dfm-fi/agent@latest`; pin a version with `args: ['-y', '@dfm-fi/agent@0.2.1969']`), `env` (extra `DFM_*` settings), `inheritProcessEnv` (default `true`), `cwd`, `clientName`.

## Configuration

The plugin starts `npx -y @dfm-fi/agent@latest` as a child process. That process gets `PATH`, `HOME` and the `DFM_*` variables you set, nothing else from your environment (the MCP SDK also adds its non-secret defaults: `LOGNAME`, `SHELL`, `TERM`, `USER`). Variables whose name contains `PRIVATE_KEY`, `SECRET_KEY`, `SEED`, `MNEMONIC` or `KEYPAIR_JSON` are never forwarded, even with a `DFM_` prefix.

| Variable | Needed for | Notes |
|---|---|---|
| none | read tools (`list_dtfs`, `get_vault`, `discover_tokens`, `get_token_price`, `swap_quote`, ...) | Work out of the box. |
| `DFM_AGENT_WRITE_ENABLED=true` | any write tool | Unset by default: the server is read-only. |
| `DFM_API_KEY` | writes for an agent operating a human's account | A revocable `dfm_` key created in the DFM app, with its own caps. |
| `DFM_AGENT_KEYPAIR_PATH` | writes for a headless agent | Path to the agent's own identity keypair file. The DFM server reads the file; the plugin never opens it. |
| `DFM_API_URL`, `DFM_RPC_URL` | optional | Defaults: `https://app.dfm.finance`, backend-submitted transactions. |

The tool list is not hard-coded: it is whatever the installed `@dfm-fi/agent` returns from `listTools`, so new DFM tools show up without a plugin release.

## License

MIT
