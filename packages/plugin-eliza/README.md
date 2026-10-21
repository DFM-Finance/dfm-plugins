# @dfm-fi/plugin-eliza

[ElizaOS](https://github.com/elizaOS/eliza) 1.x plugin for DFM. At `init` it starts DFM's MCP server (`@dfm-fi/agent`), lists its tools and registers one action per tool (`DFM_LIST_DTFS`, `DFM_GET_VAULT`, ...). When an action runs, the plugin asks the agent's model (`runtime.useModel(ModelType.OBJECT_SMALL, { schema })`) for the tool's arguments from the conversation, validates them against the tool's schema, calls the tool and replies with the result. If a required argument is missing, it asks for it instead of calling the tool.

Read-only by default. Never asks for, reads or stores a private key or seed phrase in chat. Writes need DFM_AGENT_WRITE_ENABLED=true plus either a revocable dfm_ API key (an agent operating a human's account) or the agent's own identity keypair (a headless agent).

DFM runs on Solana mainnet. Deposits are real tokens and can lose value.

## Install

```sh
npm i @dfm-fi/plugin-eliza
```

## Use

Character file:

```json
{
  "name": "MyAgent",
  "plugins": ["@elizaos/plugin-openai", "@dfm-fi/plugin-eliza"],
  "settings": {
    "secrets": {
      "DFM_AGENT_WRITE_ENABLED": "",
      "DFM_API_KEY": ""
    }
  }
}
```

Or in code:

```ts
import { dfmPlugin, createDfmElizaPlugin } from '@dfm-fi/plugin-eliza';

// default instance (one DFM server per process)
plugins: [dfmPlugin]

// or one instance per agent, with its own settings
plugins: [createDfmElizaPlugin({ env: { DFM_API_KEY: process.env.DFM_API_KEY } })]
```

The plugin needs a model provider that serves `OBJECT_SMALL` (for example `@elizaos/plugin-openai` or `@elizaos/plugin-anthropic`) for tools that take arguments. Settings are read from the plugin config, `runtime.getSetting()` (character secrets) and `DFM_*` environment variables: `DFM_API_KEY`, `DFM_API_URL`, `DFM_RPC_URL`, `DFM_AGENT_WRITE_ENABLED`, `DFM_AGENT_KEYPAIR_PATH`, `DFM_MCP_CONFIRM_REQUIRED`, `DFM_MCP_NONINTERACTIVE_WRITES`.

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
