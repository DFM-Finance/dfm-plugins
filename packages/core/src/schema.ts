import { z } from 'zod';

/**
 * The subset of JSON Schema that MCP tool `inputSchema`s use in practice.
 * Unknown keywords are ignored; unknown shapes fall back to `z.any()` so a new
 * server-side schema feature never breaks the bridge (the server validates too).
 */
export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  default?: unknown;
  nullable?: boolean;
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  [key: string]: unknown;
}

function withDescription<T extends z.ZodTypeAny>(schema: T, s: JsonSchema): T {
  return typeof s.description === 'string' && s.description.length > 0
    ? (schema.describe(s.description) as T)
    : schema;
}

function literalUnion(values: unknown[]): z.ZodTypeAny {
  if (values.length > 0 && values.every((v) => typeof v === 'string')) {
    return z.enum(values as [string, ...string[]]);
  }
  const literals = values.map((v) =>
    v === null ? z.null() : z.literal(v as string | number | boolean),
  );
  if (literals.length === 0) return z.never();
  if (literals.length === 1) return literals[0]!;
  return z.union(literals as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

function union(schemas: z.ZodTypeAny[]): z.ZodTypeAny {
  if (schemas.length === 0) return z.any();
  if (schemas.length === 1) return schemas[0]!;
  return z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

function numberSchema(s: JsonSchema, integer: boolean): z.ZodTypeAny {
  let n = z.number();
  if (integer) n = n.int();
  if (typeof s.minimum === 'number') n = n.gte(s.minimum);
  if (typeof s.maximum === 'number') n = n.lte(s.maximum);
  if (typeof s.exclusiveMinimum === 'number') n = n.gt(s.exclusiveMinimum);
  if (typeof s.exclusiveMaximum === 'number') n = n.lt(s.exclusiveMaximum);
  return n;
}

function stringSchema(s: JsonSchema): z.ZodTypeAny {
  let str = z.string();
  if (typeof s.minLength === 'number') str = str.min(s.minLength);
  if (typeof s.maxLength === 'number') str = str.max(s.maxLength);
  if (typeof s.pattern === 'string') {
    try {
      str = str.regex(new RegExp(s.pattern));
    } catch {
      // A pattern JS cannot compile is left to the server to enforce.
    }
  }
  return str;
}

function objectSchema(s: JsonSchema): z.ZodTypeAny {
  const required = new Set(s.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(s.properties ?? {})) {
    const child = jsonSchemaToZod(prop);
    shape[key] = required.has(key) ? child : child.optional();
  }
  const obj = z.object(shape);
  if (s.additionalProperties === false) return obj.strict();
  if (s.additionalProperties && typeof s.additionalProperties === 'object') {
    return obj.catchall(jsonSchemaToZod(s.additionalProperties));
  }
  return obj.passthrough();
}

function typedSchema(type: string, s: JsonSchema): z.ZodTypeAny {
  switch (type) {
    case 'string':
      return stringSchema(s);
    case 'number':
      return numberSchema(s, false);
    case 'integer':
      return numberSchema(s, true);
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    case 'array': {
      if (Array.isArray(s.items)) {
        return z.tuple(s.items.map((i) => jsonSchemaToZod(i)) as [z.ZodTypeAny, ...z.ZodTypeAny[]]);
      }
      let arr = z.array(s.items ? jsonSchemaToZod(s.items) : z.any());
      if (typeof s.minItems === 'number') arr = arr.min(s.minItems);
      if (typeof s.maxItems === 'number') arr = arr.max(s.maxItems);
      return arr;
    }
    case 'object':
      return objectSchema(s);
    default:
      return z.any();
  }
}

/**
 * Convert a JSON Schema (as returned in an MCP tool's `inputSchema`) to a zod
 * (v3 API) schema. Required/optional, descriptions, enums, nested objects and
 * arrays are preserved. Defaults are NOT applied: the server owns defaults.
 */
export function jsonSchemaToZod(input: JsonSchema | boolean | undefined): z.ZodTypeAny {
  if (input === undefined || input === true) return z.any();
  if (input === false) return z.never();
  const s = input;

  let out: z.ZodTypeAny;
  if (Array.isArray(s.enum)) {
    out = literalUnion(s.enum);
  } else if ('const' in s) {
    out = literalUnion([s.const]);
  } else if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) {
    out = union((s.anyOf ?? s.oneOf ?? []).map(jsonSchemaToZod));
  } else if (Array.isArray(s.allOf) && s.allOf.length > 0) {
    out = s.allOf
      .map(jsonSchemaToZod)
      .reduce((acc, next) => z.intersection(acc, next));
  } else if (Array.isArray(s.type)) {
    const types = s.type.filter((t) => t !== 'null');
    out = union(types.map((t) => typedSchema(t, s)));
    if (s.type.includes('null')) out = out.nullable();
  } else if (typeof s.type === 'string') {
    out = typedSchema(s.type, s);
  } else if (s.properties) {
    out = objectSchema(s);
  } else {
    out = z.any();
  }

  if (s.nullable === true) out = out.nullable();
  return withDescription(out, s);
}

/** Convert a tool's input schema; always yields an object schema. */
export function toolInputToZod(input: JsonSchema | undefined): z.ZodTypeAny {
  if (!input || (input.type === undefined && !input.properties)) {
    return z.object({}).passthrough();
  }
  return jsonSchemaToZod(input);
}
