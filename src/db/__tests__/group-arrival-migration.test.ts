import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

it('keeps legacy pending group messages silent when adding arrival provenance', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    const directory = `${process.cwd()}/src/db/migrations`;
    for (const name of readdirSync(directory).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
      if (Number.parseInt(name, 10) >= 78) continue;
      sqlite.exec(readFileSync(`${directory}/${name}`, 'utf8'));
    }
    sqlite.prepare(`INSERT INTO pending_group_rumors (
      account_pubkey, conversation_key, message_id, order_at, sender_pubkey,
      rumor, pending_reason, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('owner', 'group', 'old-event', 100, 'sender', '{}', 'membership_candidate', 1);
    sqlite.exec(readFileSync(`${directory}/0078_group-arrival-eligibility.sql`, 'utf8'));
    expect(sqlite.prepare('SELECT message_id, pending_reason, arrival_eligible FROM pending_group_rumors').get()).toEqual({
      message_id: 'old-event', pending_reason: 'membership_candidate', arrival_eligible: 0,
    });
  } finally {
    sqlite.close();
  }
});
