import { reconcileConfig, validateSchema } from '../config';

it('keeps valid saved fields across upgrades while supplying new defaults', () => {
  const schema = validateSchema({ type: 'object', properties: {
    theme: { type: 'string', default: 'light' }, count: { type: 'integer', default: 5 },
    nested: { type: 'object', properties: { enabled: { type: 'boolean', default: true } } },
  } });
  expect(reconcileConfig(schema, { theme: 'dark', count: 'old text', removed: 'ignore', nested: {} }))
    .toEqual({ theme: 'dark', count: 5, nested: { enabled: true } });
});
it('preserves object defaults and omits invalid fields without valid defaults', () => {
  const schema = validateSchema({ type: 'object', default: { name: 'Guest' }, properties: {
    name: { type: 'string' }, score: { type: 'integer', minimum: 0 },
  } });
  expect(reconcileConfig(schema, { score: -1 })).toEqual({ name: 'Guest' });
});
