/**
 * Replaces the Windows .exe icon with build/icon.ico (P.O.S. Pro logo).
 * Usage: node scripts/stamp-exe-icon.cjs <exe> <ico>
 */
const fs = require("fs");
const ResEdit = require("resedit");
const PELibrary = require("pe-library");

const exePath = process.argv[2];
const icoPath = process.argv[3];
if (!exePath || !icoPath) {
  console.error("Usage: node scripts/stamp-exe-icon.cjs <exe> <ico>");
  process.exit(1);
}

const exe = PELibrary.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = PELibrary.NtExecutableResource.from(exe);
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const icons = iconFile.icons.map((item) => item.data);

const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
if (groups.length === 0) {
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icons);
} else {
  for (const g of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, icons);
  }
}

res.outputResource(exe);
const out = `${exePath}.new`;
fs.writeFileSync(out, Buffer.from(exe.generate()));
fs.renameSync(out, exePath);
console.log("Stamped icon onto", exePath);
