import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Compile the installed dependency's relevant methods in small native probes.
// UIKit and JSI are excluded; the probes exercise selector dispatch and type equality.
function nativeProbe(extension, source, compiler, flags) {
  const directory = mkdtempSync(join(tmpdir(), 'psstpsst-ios-regression-'));
  try {
    const input = join(directory, `main.${extension}`);
    const output = join(directory, 'probe');
    writeFileSync(input, source);
    execFileSync('xcrun', [compiler, ...flags, input, '-o', output], { stdio: 'pipe' });
    execFileSync(output, [], { stdio: 'pipe' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('long-press delay remains readable and delayed activation can be cancelled', {
  skip: process.platform !== 'darwin',
}, () => {
  const source = readFileSync(new URL('../node_modules/react-native-gesture-handler/apple/Handlers/RNPanHandler.m', import.meta.url), 'utf8');
  const property = source.match(/@property \(nonatomic\) CGFloat activateAfterLongPress;/)?.[0];
  const callback = source.match(/- \(void\)activateAfterLongPress\w*\n\{[^]*?\n\}/)?.[0];
  const schedule = source.match(/\[self performSelector:@selector\(activateAfterLongPress\w*\)[^;]+;/)?.[0];
  const cancellations = [...source.matchAll(/\[NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector\(activateAfterLongPress\w*\)[^;]+;/g)];
  assert.ok(property && callback && schedule);
  assert.equal(cancellations.length, 2);
  nativeProbe('m', `
#import <Foundation/Foundation.h>
enum { UIGestureRecognizerStateBegan = 1, RNGestureHandlerStateActive = 4 };
@interface Handler : NSObject
- (void)handleGesture:(id)gesture inState:(int)state;
@end
@implementation Handler
- (void)handleGesture:(id)gesture inState:(int)state {}
@end
@interface Probe : NSObject { Handler *_gestureHandler; }
${property}
@property NSInteger state;
- (void)schedule;
- (void)cancelReset;
- (void)cancelMovement;
@end
@implementation Probe
${callback}
- (void)schedule { ${schedule} }
- (void)cancelReset { ${cancellations[0][0]} }
- (void)cancelMovement { ${cancellations[1][0]} }
@end
static void waitForTimer(void) {
  [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.08]];
}
int main(void) { @autoreleasepool {
  Probe *p = [Probe new];
  p.activateAfterLongPress = 0.02;
  if (p.activateAfterLongPress != 0.02 || p.state != 0) return 1;
  [p schedule]; waitForTimer();
  if (p.state != UIGestureRecognizerStateBegan) return 2;
  p.state = 0;
  [p schedule]; [p cancelReset]; waitForTimer();
  if (p.state != 0) return 3;
  [p schedule]; [p cancelMovement]; waitForTimer();
  if (p.state != 0) return 4;
  return 0;
}}
`, 'clang', ['-fobjc-arc', '-framework', 'Foundation']);
});

test('binary data dynamic types compare equal without matching unrelated types', {
  skip: process.platform !== 'darwin',
}, () => {
  const source = readFileSync(new URL('../node_modules/expo-modules-core/ios/Core/DynamicTypes/DynamicDataType.swift', import.meta.url), 'utf8');
  const methods = source.match(/  func wraps<[^]*?(?=  \/\*\*)/)?.[0];
  assert.ok(methods?.includes('func equals'));
  nativeProbe('swift', `
import Foundation
protocol AnyDynamicType {}
struct DynamicDataType: AnyDynamicType {
${methods}
}
struct OtherType: AnyDynamicType {}
let data = DynamicDataType()
if !data.equals(data) { exit(1) }
if !data.equals(DynamicDataType()) { exit(2) }
if data.equals(OtherType()) { exit(3) }
if !data.wraps(Data.self) || data.wraps(String.self) { exit(4) }
`, 'swiftc', ['-module-cache-path', join(tmpdir(), 'psstpsst-swift-module-cache')]);
});
