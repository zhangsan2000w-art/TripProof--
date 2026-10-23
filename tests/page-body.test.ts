import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePageBody, maxPageBytes } from '../lib/page-body';

const html = '<html><body>豫园开放时间 09:00—16:30</body></html>';
describe('source page decoding', () => {
  it.each([['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync]] as const)('decodes %s before extracting source text', (encoding, compress) => {
    expect(decodePageBody(compress(Buffer.from(html)), 'text/html; charset=utf-8', encoding)).toBe(html);
  });
  it('recognises gzip bytes when a server omits the encoding header', () => {
    expect(decodePageBody(gzipSync(Buffer.from(html)), 'text/html')).toBe(html);
  });
  it('decodes stacked encodings in reverse order', () => {
    expect(decodePageBody(brotliCompressSync(gzipSync(Buffer.from(html))), 'text/html', 'gzip, br')).toBe(html);
  });
  it('preserves uncompressed and GB2312 pages', () => {
    expect(decodePageBody(Buffer.from(html), 'text/html', 'identity')).toBe(html);
    expect(decodePageBody(Buffer.from([0xbf, 0xaa, 0xb7, 0xc5]), 'text/html; charset="GB2312"')).toBe('开放');
  });
  it('rejects invalid compression and oversized expanded pages', () => {
    expect(() => decodePageBody(Buffer.from('invalid'), 'text/html', 'gzip')).toThrow();
    expect(() => decodePageBody(gzipSync(Buffer.alloc(maxPageBytes + 1, 65)), 'text/html', 'gzip')).toThrow();
    expect(() => decodePageBody(Buffer.from(html), 'text/html', 'unknown')).toThrow('PAGE_ENCODING_NOT_SUPPORTED');
  });
  it('does not turn binary files into evidence text', () => {
    expect(decodePageBody(Buffer.from([0, 1, 2]), 'application/pdf')).toBe('');
  });
});
