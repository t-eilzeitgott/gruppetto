// Erzeugt die PNG-Icons aus public/icons/favicon.svg (einmalig lokal ausführen).
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const svg = await readFile('public/icons/favicon.svg');
const square = Buffer.from(svg.toString().replace('rx="112"', 'rx="0"'));
const maskable = Buffer.from(svg.toString()
  .replace('rx="112"', 'rx="0"')
  .replace('<text x="236" y="352"', '<g transform="translate(51 51) scale(0.8)"><text x="236" y="352"')
  .replace('</svg>', '</g></svg>')
  .replace('<circle cx="384" cy="330" r="34" fill="#FF5FA2"/>\n</g>', '<circle cx="384" cy="330" r="34" fill="#FF5FA2"/></g>'));

await sharp(svg).resize(192, 192).png().toFile('public/icons/icon-192.png');
await sharp(svg).resize(512, 512).png().toFile('public/icons/icon-512.png');
await sharp(square).resize(180, 180).png().toFile('public/icons/apple-touch-icon.png');
await sharp(maskable).resize(512, 512).png().toFile('public/icons/icon-maskable-512.png');
console.log('Icons erzeugt');
