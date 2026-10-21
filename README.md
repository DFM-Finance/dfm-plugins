# DFM agent plugins

Thin plugins that let [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) and [ElizaOS](https://github.com/elizaOS/eliza) agents use [DFM](https://app.dfm.finance) (DTF vaults on Solana). They contain no DFM tool code: each one starts DFM's MCP server ([`@dfm-fi/agent`](https://www.npmjs.com/package/@dfm-fi/agent)) over stdio, reads its tool list and exposes every tool as a native action. New tools in `@dfm-fi/agent` appear in both plugins without a release.

Read-only by default. Never asks for, reads or stores a private key or seed phrase in chat. Writes need DFM_AGENT_WRITE_ENABLED=true plus either a revocable dfm_ API key (an agent operating a human's account) or the agent's own identity keypair (a headless agent).

DFM runs on Solana mainnet. Deposits are real tokens and can lose value.

| Package | For | Exposes |
|---|---|---|
| [`@dfm-fi/mcp-bridge`](packages/core) | shared core | `DfmMcpBridge`, `jsonSchemaToZod` |
| [`@dfm-fi/plugin-sak`](packages/plugin-sak) | solana-agent-kit 2.x | `createDfmPlugin()` -> SAK `Plugin` with `DFM_*` actions |
| [`@dfm-fi/plugin-eliza`](packages/plugin-eliza) | @elizaos/core 1.x | `dfmPlugin`, `createDfmElizaPlugin()` -> Eliza `Plugin` |

## Develop

```sh
npm install
npm test        # builds, then runs schema unit tests and live read-only smoke tests against @dfm-fi/agent
```

## License

MIT
