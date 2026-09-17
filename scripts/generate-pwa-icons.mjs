import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
const output = fileURLToPath(new URL("../public/icons/", import.meta.url));
mkdirSync(output, { recursive: true });
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, name, data, checksum]);
}
for (const size of [180, 192, 512]) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size;
    const trunk = px > .31 && px < .36 && py > .3 && py < .7;
    const branches = px > .31 && px < .65 && ((py > .31 && py < .36) || (py > .64 && py < .69));
    const root = Math.hypot(px - .335, py - .5) < .08;
    const leaves = Math.hypot(px - .65, py - .335) < .085 || Math.hypot(px - .65, py - .665) < .085;
    const color = trunk || branches || root || leaves ? [241, 249, 240] : [39, 108, 99];
    const offset = y * (size * 3 + 1) + 1 + x * 3;
    raw.set(color, offset);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(`${output}/todo-${size}.png`, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
console.log("Generated PWA icons (180, 192, 512 px).");
