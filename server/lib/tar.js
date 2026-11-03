import { gzipSync } from 'node:zlib';

// Minimal ustar writer: files = [{ path, content (string|Buffer) }] -> gzipped Buffer.
export function tarGz(files, prefix = '') {
  const blocks = [];
  const mtime = Math.floor(Date.now() / 1000);
  for (const f of files) {
    const data = Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content), 'utf8');
    let name = (prefix ? prefix.replace(/\/$/, '') + '/' : '') + f.path.replace(/^\/+/, '');
    let pre = '';
    if (Buffer.byteLength(name) > 100) {
      const cut = name.lastIndexOf('/', 154);
      pre = name.slice(0, cut); name = name.slice(cut + 1);
      if (Buffer.byteLength(name) > 100 || Buffer.byteLength(pre) > 155) throw new Error(`Path too long for tar: ${f.path}`);
    }
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, 'utf8');
    h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write(mtime.toString(8).padStart(11, '0') + '\0', 136);
    h.write('        ', 148); // checksum placeholder
    h.write('0', 156);
    h.write('ustar\0', 257); h.write('00', 263);
    h.write(pre, 345, 155, 'utf8');
    let sum = 0; for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
