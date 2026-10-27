import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('iOS local relay transport notifies independent subscribers and releases observers', { skip: process.platform !== 'darwin' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'psst-relay-ios-'));
  try {
    const source = readFileSync('modules/expo-napplet/ios/LocalRelayEvents.swift', 'utf8');
    const main = join(directory, 'main.swift'), executable = join(directory, 'test');
    writeFileSync(main, source + `
var first: [String] = [], second: [String] = []
let a = LocalRelayEvents.subscribe { first.append($0) }
let b = LocalRelayEvents.subscribe { second.append($0) }
let payload = String(repeating: "x", count: 2 * 1024 * 1024 + 1)
LocalRelayEvents.publish(payload)
precondition(first == [payload] && second == [payload])
LocalRelayEvents.unsubscribe(a)
LocalRelayEvents.publish("next")
precondition(first.count == 1 && second == [payload, "next"])
LocalRelayEvents.unsubscribe(b)
`);
    execFileSync('xcrun', ['swiftc', '-module-cache-path', join(directory, 'cache'), main, '-o', executable], { stdio: 'pipe' });
    execFileSync(executable, [], { stdio: 'pipe' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
