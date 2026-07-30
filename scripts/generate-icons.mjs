/* ------------------------------------------------------------------ */
/* Generate the Tauri icon set from public/icon.svg.                   */
/*                                                                     */
/* Tauri's `tauri icon` command needs @tauri-apps/cli installed; this  */
/* repo doesn't ship it, so we render the SVG with sharp and pack the  */
/* PNGs into a Windows .ico and a macOS .icns directly. The PNGs are   */
/* also written individually because tauri.conf.json references them   */
/* by name (32x32.png, 128x128.png, icon.ico, icon.icns).              */
/*                                                                     */
/*   node scripts/generate-icons.mjs                                   */
/* ------------------------------------------------------------------ */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "public", "icon.svg");
const OUT = join(ROOT, "src-tauri", "icons");

const PNG_SIZES = [32, 128, 256, 512];

/** Pack PNG buffers into a Windows .ico (PNG-encoded entries, Vista+). */
function buildIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = 6 + count * 16;
  for (const { size, png } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 => 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(png.length, 8); // bytes in resource
    entry.writeUInt32LE(offset, 12); // image offset
    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)]);
}

/** Pack PNG buffers into a macOS .icns. */
function buildIcns(pngs) {
  // OSType codes by pixel size.
  const codeFor = (size) =>
    size === 128 ? "ic07" : size === 256 ? "ic08" : size === 512 ? "ic09" : size === 32 ? "ic11" : null;

  const chunks = [];
  for (const { size, png } of pngs) {
    const code = codeFor(size);
    if (!code) continue;
    const magic = Buffer.from(code, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(8 + png.length, 0);
    chunks.push(Buffer.concat([magic, len, png]));
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, 4, "ascii");
  head.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

async function main() {
  const svg = await readFile(SRC);
  await mkdir(OUT, { recursive: true });

  const pngs = [];
  for (const size of PNG_SIZES) {
    const png = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
    const file = join(OUT, `${size}x${size}.png`);
    await writeFile(file, png);
    pngs.push({ size, png });
    console.log(`wrote ${size}x${size}.png (${png.length} bytes)`);
  }

  const ico = buildIco([pngs.find((p) => p.size === 32), pngs.find((p) => p.size === 128), pngs.find((p) => p.size === 256)].filter(Boolean));
  await writeFile(join(OUT, "icon.ico"), ico);
  console.log(`wrote icon.ico (${ico.length} bytes)`);

  const icns = buildIcns([pngs.find((p) => p.size === 32), pngs.find((p) => p.size === 128), pngs.find((p) => p.size === 256), pngs.find((p) => p.size === 512)].filter(Boolean));
  await writeFile(join(OUT, "icon.icns"), icns);
  console.log(`wrote icon.icns (${icns.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
