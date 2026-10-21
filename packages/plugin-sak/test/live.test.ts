import { afterAll, describe, expect, it } from 'vitest';
import { SolanaAgentKit, executeAction } from 'solana-agent-kit';
import { createDfmPlugin, sakActionName, type DfmSakPlugin } from '../src/index.js';

/** A wallet/config that fails the test if anything reads it. */
const touched: string[] = [];
function tripwire(label: string): any {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        touched.push(`${label}.${String(prop)}`);
        throw new Error(`plugin touched ${label}.${String(prop)}`);
      },
    },
  );
}

describe('@dfm-fi/plugin-sak (live, read-only @dfm-fi/agent)', () => {
  let plugin: DfmSakPlugin;
  afterAll(async () => {
    await plugin?.methods.dfmClose();
  });

  it('exposes every MCP tool as a SAK action and runs DFM_LIST_DTFS', async () => {
    plugin = await createDfmPlugin({ inheritProcessEnv: false });
    const tools = await plugin.methods.dfmListTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(plugin.actions.map((a) => a.name)).toEqual(tools.map((t) => sakActionName(t.name)));

    const agent = new SolanaAgentKit(tripwire('wallet'), 'http://127.0.0.1:1', tripwire('config')).use(plugin);
    const action = agent.actions.find((a) => a.name === 'DFM_LIST_DTFS');
    expect(action).toBeDefined();

    const out = await executeAction(action!, agent, { limit: 2 });
    expect(out.status).toBe('success');
    expect(out.tool).toBe('list_dtfs');
    expect(Array.isArray((out.data as any).vaults)).toBe(true);
    expect(typeof (out.data as any).total).toBe('number');

    // Schema validation happens before the server is called.
    const bad = await executeAction(action!, agent, { limit: 999 });
    expect(bad.status).toBe('error');
    expect(bad.code).toBe('VALIDATION_ERROR');

    expect(touched).toEqual([]);
  });
});
