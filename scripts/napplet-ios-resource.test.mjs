import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('iOS resource DNS rejects private answers and preserves native failure reasons', {
  skip: process.platform !== 'darwin',
}, () => {
  const module = readFileSync(new URL('../modules/expo-napplet/ios/ExpoNappletModule.swift', import.meta.url), 'utf8');
  const transport = module.slice(module.indexOf('private func publicIP'), module.indexOf('public class ExpoNappletModule'));
  assert.ok(transport.includes('class PublicFetch'));
  const directory = mkdtempSync(join(tmpdir(), 'psst-ios-resource-'));
  try {
    const input = join(directory, 'main.swift');
    const output = join(directory, 'probe');
    // Expo's JS runtime is unavailable on macOS; keep the actual transport,
    // error subclass, Foundation DNS and Network.framework implementation.
    writeFileSync(input, `
import Foundation
import Network
import Security
class GenericException<T>: Error, @unchecked Sendable {
  let param: T
  init(_ param: T) { self.param = param }
  var code: String { "" }
  var reason: String { "undefined reason" }
}
struct Promise {
  let done: DispatchSemaphore
  let expected: String
  func resolve(_ value: Any) { fatalError("Unexpected resource success") }
  func reject(_ error: GenericException<String>) {
    precondition(error.code == "ERR_RESOURCE")
    precondition(error.reason == expected, "Lost failure reason: \\(error.reason)")
    done.signal()
  }
}
${transport}
extension PublicFetch {
  static func checkDnsResponses() throws {
    func answer(_ records: [[String: Any]], status: Int = 0, truncated: Bool = false) throws -> (address: String, ttl: TimeInterval)? {
      let data = try JSONSerialization.data(withJSONObject: ["Status": status, "TC": truncated, "Answer": records])
      return dnsAnswer(data)
    }
    let publicRecord: [String: Any] = ["type": 1, "data": "1.1.1.1", "TTL": 120]
    let valid = try answer([["type": 5, "data": "cdn.example"], publicRecord])
    precondition(valid?.address == "1.1.1.1" && valid?.ttl == 60)
    for address in ["127.0.0.1", "10.0.0.1", "192.168.1.1", "198.18.0.19", "169.254.169.254", "::1", "cdn.example", "+1.1.1.1", "1.2.3.999"] {
      let result = try answer([publicRecord, ["type": 1, "data": address, "TTL": 60]])
      precondition(result == nil, "Admitted a non-public DNS answer: \\(address)")
    }
    let zeroTTL = try answer([["type": 1, "data": "8.8.8.8", "TTL": 0]])
    let shortTTL = try answer([["type": 1, "data": "8.8.8.8", "TTL": 12]])
    precondition(zeroTTL?.ttl == 0 && shortTTL?.ttl == 12)
    let empty = try answer([])
    let failed = try answer([publicRecord], status: 3)
    let truncated = try answer([publicRecord], truncated: true)
    let oversized = try answer(Array(repeating: publicRecord, count: 65))
    precondition(empty == nil && failed == nil && truncated == nil && oversized == nil)
    precondition(dnsAnswer(Data("invalid JSON".utf8)) == nil)
  }
}
private var known = ResourceBodyProgress()
let header = "HTTP/1.1 200 OK\\r\\nContent-Length: 5\\r\\n\\r\\n"
precondition(known.update(Data((header + "ab").utf8))!.0 == 2)
precondition(known.update(Data((header + "abcde").utf8))!.1 == 5)
private var chunked = ResourceBodyProgress()
let wire = Array("HTTP/1.1 200 OK\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n3\\r\\nabc\\r\\n2;ext=1\\r\\nde\\r\\n0\\r\\n\\r\\n".utf8)
var buffer = Data()
var last = 0
for byte in wire {
  buffer.append(byte)
  if let (received, total) = chunked.update(buffer) {
    precondition(received >= last && received <= 5)
    precondition(total == nil)
    last = received
  }
}
precondition(last == 5)
private var unknown = ResourceBodyProgress()
precondition(unknown.update(Data("HTTP/1.1 200 OK\\r\\n\\r\\nabcdef".utf8))!.0 == 6)
try PublicFetch.checkDnsResponses()
for value in ["https://127.0.0.1/", "https://198.18.0.19/", "https://[::1]/", "http://example.com/", "https://user:pass@example.com/", "https://example.com:8443/"] {
  let done = DispatchSemaphore(value: 0)
  let fetch = PublicFetch(Promise(done: done, expected: "blocked-by-policy")) { }
  fetch.start(value, max: 1024)
  precondition(done.wait(timeout: .now() + 3) == .success, "Request did not terminate: \\(value)")
}
let cancelled = DispatchSemaphore(value: 0)
private let request = PublicFetch(Promise(done: cancelled, expected: "cancelled")) { }
request.cancel()
precondition(cancelled.wait(timeout: .now() + 3) == .success)
`);
    execFileSync('xcrun', ['swiftc', '-module-cache-path', join(directory, 'cache'), input, '-o', output], { stdio: 'pipe' });
    execFileSync(output, [], { stdio: 'pipe', timeout: 30000 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
