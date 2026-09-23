/**
 * Rasterize public/logo.svg at 1024px, then downscale.
 * Tiny favicons stay sharp because they come from the big bitmap, not a 16px SVG.
 *
 * Writes:
 *   public/logo.png, icon-512.png, icon-192.png, icon-32.png, favicon.ico
 *   public-web/ (same files + logo.svg)
 *   build/icon.png, build/icon.ico  (Windows EXE / shortcuts)
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const SVG_SRC = path.join(ROOT, "public", "logo.svg");
const PUBLIC = path.join(ROOT, "public");
const PUBLIC_WEB = path.join(ROOT, "public-web");
const BUILD = path.join(ROOT, "build");

function pngsToIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = 6 + 16 * count;
  const entries = [];
  for (const { size, buf } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buf.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.buf)]);
}

async function raster(svgBuf, size) {
  return sharp(svgBuf, { density: 600 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  if (!fs.existsSync(SVG_SRC)) {
    console.error("Missing public/logo.svg");
    process.exit(1);
  }
  const svgRaw = fs.readFileSync(SVG_SRC, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const svgBuf = Buffer.from(svgRaw);
  fs.mkdirSync(PUBLIC, { recursive: true });
  fs.mkdirSync(PUBLIC_WEB, { recursive: true });
  fs.mkdirSync(BUILD, { recursive: true });

  const master = await raster(svgBuf, 1024);
  const png512 = await sharp(master).resize(512, 512).png().toBuffer();
  const png192 = await sharp(master).resize(192, 192).png().toBuffer();
  const png48 = await sharp(master).resize(48, 48).png().toBuffer();
  const png32 = await sharp(master).resize(32, 32).png().toBuffer();
  const png16 = await sharp(master).resize(16, 16).png().toBuffer();
  const png256 = await sharp(master).resize(256, 256).png().toBuffer();

  const ico = pngsToIco([
    { size: 16, buf: png16 },
    { size: 32, buf: png32 },
    { size: 48, buf: png48 },
    { size: 256, buf: png256 },
  ]);

  const writes = [
    [path.join(PUBLIC, "logo.png"), master],
    [path.join(PUBLIC, "icon-512.png"), png512],
    [path.join(PUBLIC, "icon-192.png"), png192],
    [path.join(PUBLIC, "icon-32.png"), png32],
    [path.join(PUBLIC, "favicon.ico"), ico],
    [path.join(PUBLIC_WEB, "logo.png"), master],
    [path.join(PUBLIC_WEB, "icon-512.png"), png512],
    [path.join(PUBLIC_WEB, "icon-192.png"), png192],
    [path.join(PUBLIC_WEB, "icon-32.png"), png32],
    [path.join(PUBLIC_WEB, "favicon.ico"), ico],
    [path.join(BUILD, "icon.png"), png512],
    [path.join(BUILD, "icon.ico"), ico],
  ];
  for (const [file, buf] of writes) {
    fs.writeFileSync(file, buf);
    console.log("Wrote", path.relative(ROOT, file), `(${buf.length} bytes)`);
  }
  fs.copyFileSync(SVG_SRC, path.join(PUBLIC_WEB, "logo.svg"));
  console.log("Wrote public-web/logo.svg");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
