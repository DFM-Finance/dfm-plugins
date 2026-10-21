import { afterAll, describe, expect, it } from 'vitest';
import type { Action, Content, IAgentRuntime, Memory } from '@elizaos/core';
import { createDfmElizaPlugin } from '../src/index.js';

describe('@dfm-fi/plugin-eliza (live, read-only @dfm-fi/agent)', () => {
  const plugin = createDfmElizaPlugin({ inheritProcessEnv: false });
  afterAll(async () => {
    await plugin.bridge()?.close();
  });

  const registered: Action[] = [];
  const modelCalls: Array<{ type: string; params: any }> = [];
  let nextObject: Record<string, unknown> = {};
  const runtime = {
    getSetting: () => null,
    registerAction: (a: Action) => registered.push(a),
    useModel: async (type: string, params: any) => {
      modelCalls.push({ type, params });
      return nextObject;
    },
  } as unknown as IAgentRuntime;

  const msg = (text: string) => ({ content: { text, source: 'test' } }) as unknown as Memory;

  it('registers every MCP tool at init and runs DFM_LIST_DTFS from conversation', async () => {
    await plugin.init!({}, runtime);
    expect(registered.length).toBeGreaterThan(0);
    const action = registered.find((a) => a.name === 'DFM_LIST_DTFS')!;
    expect(action).toBeDefined();
    expect(await action.validate(runtime, msg('x'))).toBe(true);

    nextObject = { limit: 2, sortBy: 'tvl' };
    const replies: Content[] = [];
    const result = await action.handler(runtime, msg('show me the top 2 DTFs by TVL'), undefined, {}, async (c) => {
      replies.push(c);
      return [];
    });

    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0]!.type).toBe('OBJECT_SMALL');
    expect(modelCalls[0]!.params.schema.properties.limit).toBeDefined();
    expect(modelCalls[0]!.params.prompt).toContain('top 2 DTFs');

    expect(result && result.success).toBe(true);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.actions).toEqual(['DFM_LIST_DTFS']);
    const parsed = JSON.parse(replies[0]!.text!);
    expect(Array.isArray(parsed.vaults)).toBe(true);
  });

  it('asks for missing required params instead of calling the tool', async () => {
    const action = registered.find((a) => a.name === 'DFM_GET_VAULT')!;
    nextObject = {};
    const replies: Content[] = [];
    const result = await action.handler(runtime, msg('tell me about a vault'), undefined, {}, async (c) => {
      replies.push(c);
      return [];
    });
    expect(result && result.success).toBe(false);
    expect(replies[0]!.text).toMatch(/I need more details for get_vault: address/);
  });
});
