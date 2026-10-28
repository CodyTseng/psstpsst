import { PassThrough, Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

const capsLockDiagnostic = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+ Electron\[\d+:\d+\] TSM AdjustCapsLockLEDForKeyTransitionHandling - _ISSetPhysicalKeyboardCapsLockLED Inhibit\r?$/;

/** Filter one macOS input-system diagnostic; preserve other native and app errors. */
export function createElectronStderrFilter(platform = process.platform) {
  if (platform !== 'darwin') return new PassThrough();
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const consume = (stream, final = false) => {
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (platform !== 'darwin' || !capsLockDiagnostic.test(line)) stream.push(`${line}\n`);
    }
    // Diagnostics are short; do not retain an unbounded partial error or progress line.
    if (pending.length > 64 * 1024 || final) {
      if (platform !== 'darwin' || !capsLockDiagnostic.test(pending)) stream.push(pending);
      pending = '';
    }
  };
  return new Transform({
    transform(chunk, _encoding, done) {
      pending += decoder.write(chunk);
      consume(this);
      done();
    },
    flush(done) {
      pending += decoder.end();
      consume(this, true);
      done();
    },
  });
}

export function forwardElectronStderr(child) {
  child.stderr.pipe(createElectronStderrFilter()).pipe(process.stderr, { end: false });
}
