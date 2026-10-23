import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

export const maxPageBytes = 2_000_000;

/** Servers can send compressed pages even when the request asks for identity. */
export function decodePageBody(raw: Buffer, contentType: string, contentEncoding = ''): string {
  if (raw.length > maxPageBytes) throw new Error('PAGE_TOO_LARGE');
  if (!/(?:html|text|xml)/i.test(contentType)) return '';
  const encodings = contentEncoding.toLowerCase().split(',').map(s => s.trim()).filter(s => s && s !== 'identity');
  // Some news sites omit Content-Encoding while sending a gzip body.
  if (!encodings.length && raw[0] === 0x1f && raw[1] === 0x8b) encodings.push('gzip');
  if (encodings.length > 2) throw new Error('PAGE_ENCODING_NOT_SUPPORTED');
  let body: Uint8Array = raw;
  for (const encoding of encodings.reverse()) {
    const options = { maxOutputLength: maxPageBytes };
    if (encoding === 'gzip' || encoding === 'x-gzip') body = gunzipSync(body, options);
    else if (encoding === 'deflate') body = inflateSync(body, options);
    else if (encoding === 'br') body = brotliDecompressSync(body, options);
    else throw new Error('PAGE_ENCODING_NOT_SUPPORTED');
  }
  const charset = /charset\s*=\s*["']?(gbk|gb2312|gb18030)/i.test(contentType) ? 'gb18030' : 'utf-8';
  return new TextDecoder(charset).decode(body);
}
