import { describe, expect, it } from 'vitest';
import { buildServerEnv, jsonSchemaToZod, toolInputToZod } from '../src/index.js';

// Real inputSchema of `list_dtfs` as served by @dfm-fi/agent 0.2.1969.
const LIST_DTFS = {
  type: 'object',
  properties: {
    category: { type: 'integer' },
    sortBy: { type: 'string', enum: ['tvl', 'apy', 'createdAt', 'performance7d', 'vaultName'] },
    sortDir: { type: 'string', enum: ['asc', 'desc'] },
    search: { type: 'string', maxLength: 64 },
    creator: { type: 'string', pattern: '^[1-9A-HJ-NP-Za-km-z]{32,44}$' },
    page: { type: 'integer', exclusiveMinimum: 0 },
    limit: { type: 'integer', exclusiveMinimum: 0, maximum: 50 },
  },
  additionalProperties: false,
  $schema: 'http://json-schema.org/draft-07/schema#',
};

describe('jsonSchemaToZod', () => {
  it('converts the real list_dtfs schema', () => {
    const s = toolInputToZod(LIST_DTFS);
    expect(s.safeParse({}).success).toBe(true);
    expect(s.safeParse({ sortBy: 'tvl', limit: 5, page: 1 }).success).toBe(true);
    expect(s.safeParse({ sortBy: 'nope' }).success).toBe(false);
    expect(s.safeParse({ limit: 51 }).success).toBe(false);
    expect(s.safeParse({ limit: 0 }).success).toBe(false);
    expect(s.safeParse({ limit: 1.5 }).success).toBe(false);
    expect(s.safeParse({ creator: 'not-base58!' }).success).toBe(false);
    expect(s.safeParse({ search: 'x'.repeat(65) }).success).toBe(false);
    expect(s.safeParse({ extra: 1 }).success).toBe(false); // additionalProperties: false
  });

  it('keeps required vs optional', () => {
    const s = jsonSchemaToZod({
      type: 'object',
      properties: { vault: { type: 'string' }, usdcAmount: { type: 'number' }, note: { type: 'string' } },
      required: ['vault', 'usdcAmount'],
    });
    expect(s.safeParse({ vault: 'V', usdcAmount: 1 }).success).toBe(true);
    expect(s.safeParse({ vault: 'V' }).success).toBe(false);
    expect(s.safeParse({ usdcAmount: 1, note: 'n' }).success).toBe(false);
  });

  it('handles strings, numbers, integers, booleans', () => {
    expect(jsonSchemaToZod({ type: 'string' }).safeParse('a').success).toBe(true);
    expect(jsonSchemaToZod({ type: 'string' }).safeParse(1).success).toBe(false);
    expect(jsonSchemaToZod({ type: 'number', minimum: 0 }).safeParse(0.5).success).toBe(true);
    expect(jsonSchemaToZod({ type: 'number', minimum: 0 }).safeParse(-1).success).toBe(false);
    expect(jsonSchemaToZod({ type: 'integer' }).safeParse(2).success).toBe(true);
    expect(jsonSchemaToZod({ type: 'integer' }).safeParse(2.5).success).toBe(false);
    expect(jsonSchemaToZod({ type: 'boolean' }).safeParse(true).success).toBe(true);
    expect(jsonSchemaToZod({ type: 'boolean' }).safeParse('true').success).toBe(false);
  });

  it('handles enums (string and mixed) and const', () => {
    const e = jsonSchemaToZod({ type: 'string', enum: ['a', 'b'] });
    expect(e.safeParse('a').success).toBe(true);
    expect(e.safeParse('c').success).toBe(false);
    const m = jsonSchemaToZod({ enum: [1, 'x', null] });
    expect(m.safeParse(1).success).toBe(true);
    expect(m.safeParse(null).success).toBe(true);
    expect(m.safeParse(2).success).toBe(false);
    expect(jsonSchemaToZod({ const: 'CONFIRM' }).safeParse('CONFIRM').success).toBe(true);
    expect(jsonSchemaToZod({ const: 'CONFIRM' }).safeParse('no').success).toBe(false);
  });

  it('handles arrays of objects (launch_vault-style assets)', () => {
    const s = jsonSchemaToZod({
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: { mint: { type: 'string' }, bps: { type: 'integer' } },
        required: ['mint', 'bps'],
      },
    });
    expect(s.safeParse([{ mint: 'M', bps: 10000 }]).success).toBe(true);
    expect(s.safeParse([]).success).toBe(false);
    expect(s.safeParse([{ mint: 'M' }]).success).toBe(false);
  });

  it('handles nullable type arrays and anyOf', () => {
    const n = jsonSchemaToZod({ type: ['string', 'null'] });
    expect(n.safeParse(null).success).toBe(true);
    expect(n.safeParse('x').success).toBe(true);
    expect(n.safeParse(1).success).toBe(false);
    const u = jsonSchemaToZod({ anyOf: [{ type: 'string' }, { type: 'number' }] });
    expect(u.safeParse(1).success).toBe(true);
    expect(u.safeParse(true).success).toBe(false);
  });

  it('keeps descriptions', () => {
    const s = jsonSchemaToZod({
      type: 'object',
      properties: { vault: { type: 'string', description: 'Vault address' } },
      required: ['vault'],
      description: 'args',
    });
    expect(s.description).toBe('args');
    expect((s as any).shape.vault.description).toBe('Vault address');
  });

  it('falls back to any for unknown shapes and empty input schemas', () => {
    expect(jsonSchemaToZod({ $ref: '#/x' }).safeParse({ anything: 1 }).success).toBe(true);
    expect(toolInputToZod(undefined).safeParse({}).success).toBe(true);
    expect(toolInputToZod({ type: 'object' }).safeParse({}).success).toBe(true);
  });
});

describe('buildServerEnv', () => {
  it('passes only PATH, HOME and DFM_* and blocks key material', () => {
    const saved = { ...process.env };
    try {
      process.env.DFM_API_URL = 'https://example.invalid';
      process.env.OPENAI_API_KEY = 'leak-me-not';
      process.env.SOLANA_PRIVATE_KEY = 'leak-me-not';
      process.env.DFM_AGENT_KEYPAIR_JSON = '[1,2,3]';
      delete process.env.DFM_AGENT_WRITE_ENABLED;
      const env = buildServerEnv({ env: { DFM_API_KEY: 'dfm_x', NOT_DFM: 'y', DFM_SEED_PHRASE: 'z' } });
      expect(env.PATH).toBe(process.env.PATH);
      expect(env.HOME).toBe(process.env.HOME);
      expect(env.DFM_API_URL).toBe('https://example.invalid');
      expect(env.DFM_API_KEY).toBe('dfm_x');
      for (const k of ['OPENAI_API_KEY', 'SOLANA_PRIVATE_KEY', 'DFM_AGENT_KEYPAIR_JSON', 'NOT_DFM', 'DFM_SEED_PHRASE']) {
        expect(env[k]).toBeUndefined();
      }
      expect(env.DFM_AGENT_WRITE_ENABLED).toBeUndefined();
      const keys = Object.keys(env).filter((k) => k !== 'PATH' && k !== 'HOME');
      expect(keys.every((k) => k.startsWith('DFM_'))).toBe(true);
    } finally {
      process.env = saved;
    }
  });

  it('can ignore process.env entirely', () => {
    const saved = { ...process.env };
    try {
      process.env.DFM_AGENT_WRITE_ENABLED = 'true';
      const env = buildServerEnv({ inheritProcessEnv: false });
      expect(env.DFM_AGENT_WRITE_ENABLED).toBeUndefined();
    } finally {
      process.env = saved;
    }
  });
});
