import { signingTemplate } from '../event-template';

const event = { kind: 1, created_at: 1, tags: [] as string[][], content: '' };

it('preserves a complete follow list beyond the former tag limit', () => {
  const tags = Array.from({ length: 2000 }, (_, index) => ['p', index.toString(16).padStart(64, '0')]);
  expect(signingTemplate({ ...event, kind: 3, tags }).tags).toEqual(tags);
});

it('preserves long content and arbitrary string fields in tags', () => {
  const input = { ...event, content: '文章'.repeat(40000),
    tags: [['custom', ...Array.from({ length: 32 }, () => 'x'.repeat(5000))]] };
  const result = signingTemplate(input);
  expect(result).toEqual(input);
  expect(result.tags).not.toBe(input.tags);
  expect(result.tags[0]).not.toBe(input.tags[0]);
});

it.each([-1, 0, 1, Math.floor(Date.now() / 1000) + 10 * 365 * 86400])(
  'preserves the submitted timestamp %s without applying a time window', created_at => {
    expect(signingTemplate({ ...event, created_at }).created_at).toBe(created_at);
  },
);

it.each([
  { kind: -1 }, { kind: 65536 }, { kind: 1.5 },
  { content: null }, { created_at: '1' }, { created_at: 1.5 },
  { created_at: NaN }, { created_at: Infinity },
  { tags: null }, { tags: ['p'] }, { tags: [[]] }, { tags: [['p', 1]] },
])('rejects malformed event fields: %j', fields => {
  expect(() => signingTemplate({ ...event, ...fields })).toThrow('invalid-event');
});

it('copies only unsigned fields from a request', () => {
  expect(signingTemplate({ ...event, id: 'untrusted', pubkey: 'untrusted', sig: 'untrusted' })).toEqual(event);
});


it('validates generic publication events without interpreting their kind as relay authentication', () => {
  const input = { ...event, kind: 22242, content: 'ordinary event', tags: [['custom', 'tag']] };
  expect(signingTemplate(input, false)).toEqual(input);
  expect(() => signingTemplate(input)).toThrow('invalid-auth');
});
