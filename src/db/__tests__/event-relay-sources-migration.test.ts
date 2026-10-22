import { readFileSync } from 'node:fs';
import { applicationTestDatabase } from '@/services/explore/testing/database';

it('keeps existing events and leaves historical relay sources unknown', () => {
  const fixture = applicationTestDatabase(true);
  try {
    fixture.sqlite.exec(readFileSync(`${process.cwd()}/src/db/migrations/0071_event-backed-applications.sql`, 'utf8'));
    fixture.sqlite.prepare('INSERT INTO replaceable_events(pubkey,kind,d_tag,event,created_at,fetched_at) VALUES (?,35130,?,?,1,2)')
      .run('author', 'app', '{"id":"replaceable"}');
    fixture.sqlite.prepare('INSERT INTO cached_events(id,event,fetched_at) VALUES (?,?,2)').run('immutable', '{"id":"immutable"}');
    fixture.sqlite.exec(readFileSync(`${process.cwd()}/src/db/migrations/0072_event-relay-sources.sql`, 'utf8'));
    expect(fixture.sqlite.prepare('SELECT event,relays,fetched_at FROM replaceable_events').get())
      .toEqual({ event: '{"id":"replaceable"}', relays: '[]', fetched_at: 2 });
    expect(fixture.sqlite.prepare('SELECT event,relays,fetched_at FROM cached_events').get())
      .toEqual({ event: '{"id":"immutable"}', relays: '[]', fetched_at: 2 });
  } finally { fixture.sqlite.close(); }
});
