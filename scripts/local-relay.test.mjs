import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { finalizeEvent,generateSecretKey } from 'nostr-tools';

const require=createRequire(import.meta.url);
test('device-wide local relay persists verified public events, indexes filters and streams incremental writes',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'psst-local-relay-'));
 const sqlite=new DatabaseSync(':memory:');
 try{
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync('src/db/migrations/0063_local-relay.sql','utf8'));
  await build({entryPoints:['src/services/local-relay/relay.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(dir,'relay.cjs')});
  const {LocalRelay}=require(path.join(dir,'relay.cjs'));
  const executor={
   async execute(sql,params,method){const stmt=sqlite.prepare(sql);return {rows:method==='run'?stmt.run(...params):stmt.all(...params).map(row=>stmt.columns().map(column=>row[column.name]))};},
   async transaction(work){sqlite.exec('BEGIN');try{const result=await work(executor);sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}},
  };
  const relay=new LocalRelay(executor),sk=generateSecretKey(),other=generateSecretKey();
  const signed=(kind,created_at,tags=[],content='note',key=sk)=>finalizeEvent({kind,created_at,tags,content},key);
  const a=signed(1,10,[['p','b'.repeat(64)],['t','nostr'],['t','nostr'],['T','topic']]);
  const b=signed(1,20,[['t','nostr']]);
  const seen=[];const close=relay.subscribe([{kinds:[1],limit:0}],event=>{seen.push(event);event.content='consumer mutation';});
  assert.equal(await relay.add(a),true);assert.equal(await relay.add(a),false);assert.equal(await relay.add(b),true);
  assert.equal(seen.length,2);assert.equal((await relay.event(a.id)).content,'note');
  assert.deepEqual((await relay.query([{'#p':['b'.repeat(64)]},{ids:[b.id]}])).map(e=>e.id),[b.id,a.id]);
  assert.deepEqual(await relay.query({ids:[]}),[]);assert.deepEqual(await relay.query({limit:0}),[]);
  assert.equal(await relay.count({kinds:[1],limit:1}),2);
  assert.equal((await relay.query({kinds:[1],since:10,until:10}))[0].id,a.id);
  assert.equal((await relay.query({'#t':['nostr'],'#T':['topic']}))[0].id,a.id);
  assert.equal(await relay.count({'#T':['topic']}),1);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM local_relay_tags WHERE event_id=?').get(a.id).n,3);
  const first=signed(30023,30,[['d','article']]);const newer=signed(30023,31,[['d','article']]);
  await relay.add(first);await relay.add(newer);assert.equal(await relay.add(first),false);
  assert.equal((await relay.replaceable(30023,first.pubkey,'article')).id,newer.id);
  const tie=signed(30023,31,[['d','article']],'other');await relay.add(tie);
  assert.equal((await relay.replaceable(30023,first.pubkey,'article')).id,[newer.id,tie.id].sort()[0]);
  assert.equal(await relay.event(first.id),undefined);
  const metadata=signed(0,30,[],'{}');await relay.add(metadata);assert.equal((await relay.replaceable(0,metadata.pubkey)).id,metadata.id);
  await assert.rejects(relay.add({...a,content:'tampered'}),/invalid-signature/);
  await assert.rejects(relay.add(signed(1059,40)),/private-event/);
  await assert.rejects(relay.add(signed(4,40)),/private-event/);
  assert.equal(await relay.add(signed(1,40,[['expiration','1']])),false);
  const ephemeral=signed(20001,50);let live;const stop=relay.subscribe({kinds:[20001]},event=>{live=event;});
  await relay.add(ephemeral);assert.equal(live.id,ephemeral.id);assert.equal(await relay.event(ephemeral.id),undefined);stop();
  const secondAccountView=new LocalRelay(executor);assert.equal((await secondAccountView.event(a.id)).id,a.id);
  const concurrent=[signed(1,60,[], 'one',other),signed(1,61,[], 'two',other)];
  await Promise.all(concurrent.map(event=>relay.add(event)));assert.equal(await relay.count({authors:[concurrent[0].pubkey]}),2);
  const removed=await relay.remove([a.id,'f'.repeat(64)]);assert.deepEqual(removed,[a.id]);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM local_relay_tags WHERE event_id=?').get(a.id).n,0);
  close();await relay.add(signed(1,62));assert.equal(seen.length,4);
  const stats=sqlite.prepare('SELECT events,bytes FROM local_relay_stats').get();
  const totals=sqlite.prepare('SELECT count(*) AS events,sum(bytes) AS bytes FROM local_relay_events').get();
  assert.deepEqual({...stats},{...totals});
  await assert.rejects(relay.query({search:'text'}),/unsupported-filter/);
  await assert.rejects(relay.query({'#client':['example']}),/unsupported-filter/);
  await assert.rejects(relay.query({authors:['not-a-key']}),/invalid-filter/);
  const plan=sqlite.prepare('EXPLAIN QUERY PLAN SELECT event_id FROM local_relay_tags WHERE name=? AND value=?').all('p','b'.repeat(64));
  assert(plan.some(row=>row.detail.includes('local_relay_tag_lookup')));
  // Seed a realistic cache size without spending this query test on signature generation.
  sqlite.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000)
    INSERT INTO local_relay_events(id,pubkey,kind,created_at,stored_at,bytes,event)
    SELECT printf('%064x',x),'${'c'.repeat(64)}',1,x,1,100,
      json_object('id',printf('%064x',x),'created_at',x,'kind',1,'tags',json_array(),'content','fixture') FROM n;
    INSERT INTO local_relay_tags SELECT id,'p',printf('%064x',created_at%1000) FROM local_relay_events WHERE pubkey='${'c'.repeat(64)}';
    INSERT INTO local_relay_tags SELECT id,'t','topic'||(created_at%10) FROM local_relay_events WHERE pubkey='${'c'.repeat(64)}';`);
  const compoundSql=`SELECT event FROM local_relay_events WHERE kind=1
    AND id IN (SELECT event_id FROM local_relay_tags WHERE name='p' AND value=?)
    AND id IN (SELECT event_id FROM local_relay_tags WHERE name='t' AND value=?)
    ORDER BY created_at DESC,id LIMIT 50`;
  const p='0'.repeat(63)+'1';
  const compoundPlan=sqlite.prepare('EXPLAIN QUERY PLAN '+compoundSql).all(p,'topic1');
  assert.equal(compoundPlan.filter(row=>row.detail.includes('local_relay_tag_lookup')).length,2);
  assert(!compoundPlan.some(row=>row.detail.startsWith('SCAN local_relay_events')));
  const start=performance.now();
  assert.equal((await relay.query({kinds:[1],'#p':[p],'#t':['topic1'],limit:50})).length,50);
  console.log('100k-event, two-tag query:',(performance.now()-start).toFixed(1),'ms');
 }finally{sqlite.close();await rm(dir,{recursive:true,force:true});}
});
