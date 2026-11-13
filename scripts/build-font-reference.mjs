import fs from 'node:fs';
import opentype from 'opentype.js';

const refPath = process.argv[2];
const outPath = process.argv[3];
if (!refPath || !outPath) throw new Error('usage: build_reference_index.mjs <ref.ttf> <out.json>');
const ref = opentype.parse(fs.readFileSync(refPath).buffer);

function fnv1a64(text) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, '0');
}

function glyphStructure(glyph) {
  return glyph.path.commands.map((command) => command.type).join('');
}

function glyphPoints(glyph) {
  const points = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const command of glyph.path.commands) {
    let pairs = [];
    if (command.type === 'M' || command.type === 'L') pairs = [[command.x, command.y]];
    else if (command.type === 'Q') pairs = [[command.x1, command.y1], [command.x, command.y]];
    else if (command.type === 'C') pairs = [[command.x1, command.y1], [command.x2, command.y2], [command.x, command.y]];
    for (const [x, y] of pairs) {
      points.push([x, y]);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (!points.length) return [];
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  return points.flatMap(([x, y]) => [
    Math.round(((x - minX) / width) * 1000) / 1000,
    Math.round(((y - minY) / height) * 1000) / 1000
  ]);
}

function charPriority(cp) {
  if (cp >= 0x4e00 && cp <= 0x9fff) return 0;
  if (cp >= 0x3000 && cp <= 0x303f) return 1;
  if (cp >= 0x20 && cp <= 0x7e) return 2;
  return 3;
}

const glyphChars = new Map();
for (const [cpText, gid] of Object.entries(ref.tables.cmap.glyphIndexMap || {})) {
  const cp = Number(cpText);
  if (!(cp >= 0x4e00 && cp <= 0x9fff || cp >= 0x3000 && cp <= 0x303f || cp >= 0x20 && cp <= 0x7e)) continue;
  const existing = glyphChars.get(gid);
  if (!existing || charPriority(cp) < charPriority(existing)) glyphChars.set(gid, cp);
}

const signatureGroups = new Map();
for (const [gid, cp] of glyphChars) {
  const glyph = ref.glyphs.get(gid);
  if (!glyph?.path?.commands?.length) continue;
  const signature = glyphStructure(glyph);
  const points = glyphPoints(glyph);
  if (!points.length) continue;
  const key = fnv1a64(signature);
  let group = signatureGroups.get(key);
  if (!group) { group = []; signatureGroups.set(key, group); }
  const pointsKey = points.join(',');
  const duplicate = group.find((item) => item.pointsKey === pointsKey);
  if (duplicate) {
    if (charPriority(cp) < charPriority(duplicate.cp)) { duplicate.cp = cp; duplicate.char = String.fromCodePoint(cp); }
  } else {
    group.push({ cp, char: String.fromCodePoint(cp), points, pointsKey });
  }
}

const entries = {};
let multiGroups = 0;
let multiEntries = 0;
let unique = 0;
for (const [key, group] of signatureGroups) {
  if (group.length === 1) {
    entries[key] = group[0].char;
    unique += 1;
  } else {
    entries[key] = group.map((item) => [item.char, item.points]);
    multiGroups += 1;
    multiEntries += group.length;
  }
}
const output = { version: 1, entries };
fs.writeFileSync(outPath, JSON.stringify(output), 'utf8');
console.log(JSON.stringify({ groups: signatureGroups.size, unique, multiGroups, multiEntries, bytes: fs.statSync(outPath).size }, null, 2));
