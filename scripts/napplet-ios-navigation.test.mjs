import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('iOS separates internal frame navigation from browser handoffs', {
  skip: process.platform !== 'darwin',
}, () => {
  const source = readFileSync(new URL('../modules/expo-napplet/ios/ExpoNappletModule.swift', import.meta.url), 'utf8');
  const helpers = source.slice(source.indexOf('private func browserHandoffURL'), source.indexOf('final class NappletView:'));
  assert.ok(helpers.includes('private func isInternalBrowserSubframe'));
  const directory = mkdtempSync(join(tmpdir(), 'psst-ios-navigation-'));
  try {
    const input = join(directory, 'main.swift');
    const output = join(directory, 'probe');
    writeFileSync(input, `import Foundation
${helpers}
for value in ["about:blank", "about:srcdoc", "about:blank#frame", "javascript:void(0)", "JAVASCRIPT:void(0)", "data:text/html,hello", "blob:https://site.example/id", "file:///tmp/page.html", "psst-explore://other/index.html", "app://private", "psstpsst-file://private", "shell:command"] {
  precondition(browserHandoffURL(value) == nil, "Internal URL escaped: \\(value)")
}
precondition(browserHandoffURL(nil) == nil)
precondition(browserHandoffURL("/relative/path") == nil)
precondition(browserHandoffURL("https://site.example/" + String(repeating: "x", count: 8192)) == nil)
for value in ["https://jumble.social/", "http://site.example/", "nostr:npub1test", "mailto:user@example.com", "tel:12345"] {
  precondition(browserHandoffURL(value) != nil, "Valid handoff was rejected: \\(value)")
}
for value in ["about:blank", "about:srcdoc", "about:blank#frame"] {
  precondition(isInternalBrowserSubframe(URL(string: value), mainFrame: false))
  precondition(!isInternalBrowserSubframe(URL(string: value), mainFrame: true))
}
for value in ["about:config", "javascript:void(0)", "file:///tmp/page.html", "nostr:npub1test"] {
  precondition(!isInternalBrowserSubframe(URL(string: value), mainFrame: false))
}
`);
    execFileSync('xcrun', ['swiftc', input, '-o', output], { stdio: 'pipe' });
    execFileSync(output, [], { stdio: 'pipe' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
