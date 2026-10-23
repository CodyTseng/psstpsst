export type ConfigSchema = {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, ConfigSchema>;
  required?: string[];
  items?: ConfigSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  maxItems?: number;
};
export function validateSchema(input: unknown, depth = 0): ConfigSchema {
  if (!input || typeof input !== 'object' || Array.isArray(input) || depth > 5)
    throw new Error('invalid-schema');
  const value = input as ConfigSchema;
  for (const key of ['title', 'description'] as const)
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key]!.length > 2000)) throw new Error('invalid-schema');
  if (
    !['object', 'string', 'number', 'integer', 'boolean', 'array'].includes(value.type) ||
    '$ref' in value || 'pattern' in value || 'patternProperties' in value ||
    JSON.stringify(value).length > 32000
  )
    throw new Error('invalid-schema');
  if (value.enum && (!Array.isArray(value.enum) || value.enum.length > 64))
    throw new Error('invalid-schema');
  if (value.type === 'object') {
    if (!value.properties || typeof value.properties !== 'object' || Array.isArray(value.properties) || Object.keys(value.properties).length > 32)
      throw new Error('invalid-schema');
    for (const [key, child] of Object.entries(value.properties)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw new Error('invalid-schema');
      validateSchema(child, depth + 1);
    }
    if (
      value.required &&
      (!Array.isArray(value.required) || value.required.length > 32 || value.required.some((key) => typeof key !== 'string' || !Object.hasOwn(value.properties!, key)))
    )
      throw new Error('invalid-schema');
  }
  if (value.type === 'array') validateSchema(value.items, depth + 1);
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'maxItems'] as const) {
    if (value[key] != null && !Number.isFinite(value[key])) throw new Error('invalid-schema');
  }
  return value;
}
export function configDefaults(schema: ConfigSchema): unknown {
  if (schema.default !== undefined) return schema.default;
  if (schema.type === 'object')
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).flatMap(([key, child]) => {
        const value = configDefaults(child);
        return value === undefined ? [] : [[key, value]];
      }),
    );
  return undefined;
}
export function validateValues(schema: ConfigSchema, value: unknown): void {
  if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value)))
    throw new Error('invalid-value');
  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('invalid-value');
      const object = value as Record<string, unknown>;
      if (schema.required?.some((key) => !(key in object))) throw new Error('required-value');
      for (const [key, item] of Object.entries(object)) {
        const child = schema.properties?.[key];
        if (!child) throw new Error('invalid-value');
        validateValues(child, item);
      }
      break;
    }
    case 'array':
      if (!Array.isArray(value) || value.length > Math.min(schema.maxItems ?? 100, 100))
        throw new Error('invalid-value');
      value.forEach((item) => validateValues(schema.items!, item));
      break;
    case 'string':
      if (
        typeof value !== 'string' ||
        value.length < (schema.minLength ?? 0) ||
        value.length > Math.min(schema.maxLength ?? 16000, 16000)
      )
        throw new Error('invalid-value');
      break;
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error('invalid-value');
      break;
    default:
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (schema.type === 'integer' && !Number.isSafeInteger(value)) ||
        value < (schema.minimum ?? -Infinity) ||
        value > (schema.maximum ?? Infinity)
      )
        throw new Error('invalid-value');
  }
}

/** Preserve valid values across upgrades and apply defaults for new or changed fields. */
export function reconcileConfig(schema: ConfigSchema, saved: unknown): unknown {
  if (schema.type === 'object') {
    const values = { ...(schema.default && typeof schema.default === 'object' ? schema.default : {}),
      ...(saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Record<string, unknown> : {}) } as Record<string, unknown>;
    return Object.fromEntries(Object.entries(schema.properties ?? {}).flatMap(([key, child]) => {
      const value = reconcileConfig(child, values[key]);
      return value === undefined ? [] : [[key, value]];
    }));
  }
  try { validateValues(schema, saved); return saved; }
  catch {
    const fallback = configDefaults(schema);
    try { validateValues(schema, fallback); return fallback; }
    catch { return undefined; }
  }
}
