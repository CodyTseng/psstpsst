import { blossomDownloadUrls, buildBlossomUri, parseBlossomUri } from '../blossom-uri';

const HASH = 'ab'.repeat(32);

describe('BUD-10 Blossom URI', () => {
  it('builds the Nearby form with ordered xs hints and no as or sz', () => {
    const uri = buildBlossomUri(HASH, [
      'https://ONE.example/',
      'https://two.example/path/',
    ]);

    expect(uri).toBe(
      `blossom:${HASH}.bin?xs=https%3A%2F%2Fone.example&xs=https%3A%2F%2Ftwo.example%2Fpath`,
    );
    expect(uri).not.toContain('as=');
    expect(uri).not.toContain('sz=');
    expect(blossomDownloadUrls(parseBlossomUri(uri)!)).toEqual([
      `https://one.example/${HASH}.bin`,
      `https://two.example/path/${HASH}.bin`,
    ]);
  });

  it('accepts interoperable as and sz hints without trusting unknown parameters', () => {
    const uri = `blossom:${HASH}.bin?xs=${encodeURIComponent('https://media.example')}&as=${'cd'.repeat(32)}&sz=99&future=value`;
    expect(parseBlossomUri(uri)).toEqual({
      sha256: HASH,
      extension: '.bin',
      servers: ['https://media.example'],
      authors: ['cd'.repeat(32)],
      size: 99,
    });
  });

  it('resolves a scheme-less xs hint with HTTPS preference and HTTP fallback', () => {
    const parsed = parseBlossomUri(`blossom:${HASH}.bin?xs=media.example`)!;
    expect(parsed.servers).toEqual(['https://media.example', 'http://media.example']);
    expect(blossomDownloadUrls(parsed)).toEqual([
      `https://media.example/${HASH}.bin`,
      `http://media.example/${HASH}.bin`,
    ]);
  });

  it('rejects malformed hashes, hints, and authority-form URIs', () => {
    expect(parseBlossomUri('blossom:not-a-hash.bin?xs=https://media.example')).toBeNull();
    expect(parseBlossomUri(`blossom://${HASH}.bin?xs=https://media.example`)).toBeNull();
    expect(parseBlossomUri(`blossom:${HASH}.bin?xs=ftp://media.example`)).toBeNull();
  });
});
