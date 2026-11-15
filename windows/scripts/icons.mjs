// Assemble existing, approved feather PNGs into ICO without redrawing the artwork.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { windows } from './paths.mjs';
import { createHash } from 'node:crypto';
const sizes = [16, 32, 64, 128, 256];
const images = await Promise.all(sizes.map(size => readFile(join(windows, `assets/source/${size}.png`))));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((png, i) => {
  if (png.readUInt32BE(16) !== sizes[i] || png.readUInt32BE(20) !== sizes[i]) throw new Error('Unexpected icon dimensions');
  const entry = 6 + i * 16;
  header[entry] = sizes[i] % 256; header[entry + 1] = sizes[i] % 256;
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
const ico = Buffer.concat([header, ...images]);
await writeFile(join(windows, 'assets/app-icon.ico'), ico);
console.log(`Assembled feather ICO: ${sizes.join(', ')}px, SHA256 ${createHash('sha256').update(ico).digest('hex')}`);
