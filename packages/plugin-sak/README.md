# @dfm-fi/plugin-sak

[Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) v2 plugin for DFM. Every tool of DFM's MCP server (`@dfm-fi/agent`) becomes a native SAK action: `list_dtfs` becomes `DFM_LIST_DTFS`, `get_vault` becomes `DFM_GET_VAULT`, and so on, each with a zod schema built from the tool's JSON Schema.

Read-only by default. Never asks for, reads or stores a private key or seed phrase in chat. Writes need DFM_AGENT_WRITE_ENABLED=true plus either a revocable dfm_ API key (an agent operating a human's account) or the agent's own identity keypair (a headless agent).

DFM runs on Solana mainnet. Deposits are real tokens and can lose value.

The plugin never reads, forwards or logs your SAK wallet. Its action handlers ignore the `agent` argument; DFM signs with its own credentials (see Configuration), not with `agent.wallet`.

## Install

```sh
npm i @dfm-fi/plugin-sak solana-agent-kit
```

## Use

SAK's `agent.use()` is synchronous and reads `plugin.actions` at once, so create the plugin first (this starts the DFM server and lists its tools):

```ts
import { SolanaAgentKit, createVercelAITools } from 'solana-agent-kit';
import { createDfmPlugin } from '@dfm-fi/plugin-sak';

const dfm = await createDfmPlugin();          // read-only by default
const agent = new SolanaAgentKit(wallet, process.env.RPC_URL!, {}).use(dfm);

const tools = createVercelAITools(agent, agent.actions);   // DFM_* actions included
const dtfs = await agent.methods.dfmCallTool('list_dtfs', { limit: 5 });

// on shutdown
await agent.methods.dfmClose();
```

Plugin methods: `dfmCallTool(name, args)`, `dfmListTools()`, `dfmClose()`. Options: everything `@dfm-fi/mcp-bridge` takes, plus `actionPrefix` (default `DFM_`) and `bridge` (reuse one connection).

Writes, once enabled:

```ts
const dfm = await createDfmPlugin({
  env: { DFM_AGENT_WRITE_ENABLED: 'true', DFM_API_KEY: process.env.DFM_API_KEY },
});
```

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
