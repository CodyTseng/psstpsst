import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { createUploadProgressTransform } from '../upload-progress';

describe('desktop upload progress stream', () => {
  it('forwards every byte while reporting progress', async () => {
    const chunks: Buffer[] = [];
    const progress = jest.fn();

    await pipeline(
      Readable.from([Buffer.from('abc'), Buffer.from('def')]),
      createUploadProgressTransform(6, progress),
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
      }),
    );

    expect(Buffer.concat(chunks).toString()).toBe('abcdef');
    expect(progress.mock.calls).toEqual([
      [3, 6],
      [6, 6],
    ]);
  });
});
