/**
 * sfnt surgery: build OpenType kerning tables and splice them into a font
 * binary produced by opentype.js, which writes no GPOS or kern of its own.
 *
 * Two tables are emitted for the same pairs:
 *   GPOS / `kern` feature — used by every modern text engine;
 *   legacy `kern` format 0 — used by older design applications.
 */

const HEAD_CHECKSUM_MAGIC = 0xb1b0afba;

class ByteWriter {
  private bytes: number[] = [];

  get length(): number {
    return this.bytes.length;
  }

  uint8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  uint16(value: number): void {
    this.bytes.push((value >>> 8) & 0xff, value & 0xff);
  }

  int16(value: number): void {
    this.uint16(value < 0 ? value + 0x10000 : value);
  }

  uint32(value: number): void {
    this.bytes.push(
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
  }

  tag(value: string): void {
    for (let i = 0; i < 4; i += 1) {
      this.uint8(value.charCodeAt(i));
    }
  }

  raw(data: Uint8Array): void {
    for (const byte of data) {
      this.bytes.push(byte);
    }
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

/** One resolved kerning adjustment in font units. */
export interface KernPair {
  left: number;
  right: number;
  value: number;
}

function floorLog2(value: number): number {
  let result = 0;
  let n = value;
  while (n > 1) {
    n >>= 1;
    result += 1;
  }
  return result;
}

/**
 * GPOS with a single `kern` feature: DFLT script, one PairPos format-1 lookup.
 * Shapers fall back to DFLT when a script tag is absent, so Latin and Cyrillic
 * both pick this up.
 */
export function buildGposKernTable(pairs: readonly KernPair[]): Uint8Array | null {
  if (pairs.length === 0) {
    return null;
  }

  // Group by first glyph; coverage must be sorted by glyph id.
  const grouped = new Map<number, KernPair[]>();
  for (const pair of pairs) {
    const bucket = grouped.get(pair.left);
    if (bucket) {
      bucket.push(pair);
    } else {
      grouped.set(pair.left, [pair]);
    }
  }
  const firstGlyphs = [...grouped.keys()].sort((a, b) => a - b);
  for (const glyph of firstGlyphs) {
    grouped.get(glyph)!.sort((a, b) => a.right - b.right);
  }

  const pairSetCount = firstGlyphs.length;
  const subtableHeaderSize = 10 + 2 * pairSetCount;
  const coverageOffset = subtableHeaderSize;
  const coverageSize = 4 + 2 * pairSetCount;

  const pairSetOffsets: number[] = [];
  let cursor = coverageOffset + coverageSize;
  for (const glyph of firstGlyphs) {
    pairSetOffsets.push(cursor);
    cursor += 2 + 4 * grouped.get(glyph)!.length;
  }
  const subtable = new ByteWriter();
  subtable.uint16(1); // posFormat
  subtable.uint16(coverageOffset);
  subtable.uint16(0x0004); // valueFormat1: X_ADVANCE
  subtable.uint16(0x0000); // valueFormat2: none
  subtable.uint16(pairSetCount);
  for (const offset of pairSetOffsets) {
    subtable.uint16(offset);
  }
  subtable.uint16(1); // coverage format
  subtable.uint16(pairSetCount);
  for (const glyph of firstGlyphs) {
    subtable.uint16(glyph);
  }
  for (const glyph of firstGlyphs) {
    const bucket = grouped.get(glyph)!;
    subtable.uint16(bucket.length);
    for (const pair of bucket) {
      subtable.uint16(pair.right);
      subtable.int16(pair.value);
    }
  }

  const scriptListSize = 20;
  const featureListSize = 14;
  const headerSize = 10;
  const scriptListOffset = headerSize;
  const featureListOffset = scriptListOffset + scriptListSize;
  const lookupListOffset = featureListOffset + featureListSize;

  const out = new ByteWriter();
  out.uint16(1); // majorVersion
  out.uint16(0); // minorVersion
  out.uint16(scriptListOffset);
  out.uint16(featureListOffset);
  out.uint16(lookupListOffset);

  // ScriptList: one DFLT script pointing at a default LangSys.
  out.uint16(1);
  out.tag('DFLT');
  out.uint16(8); // script table offset from ScriptList start
  out.uint16(4); // defaultLangSys offset from script table start
  out.uint16(0); // langSysCount
  out.uint16(0); // lookupOrder
  out.uint16(0xffff); // requiredFeatureIndex
  out.uint16(1); // featureIndexCount
  out.uint16(0); // featureIndices[0]

  // FeatureList: one 'kern' feature using lookup 0.
  out.uint16(1);
  out.tag('kern');
  out.uint16(8); // feature table offset from FeatureList start
  out.uint16(0); // featureParams
  out.uint16(1); // lookupIndexCount
  out.uint16(0); // lookupListIndices[0]

  // LookupList: one pair-adjustment lookup.
  out.uint16(1);
  out.uint16(4); // lookup offset from LookupList start
  out.uint16(2); // lookupType: PairPos
  out.uint16(0); // lookupFlag
  out.uint16(1); // subTableCount
  out.uint16(8); // subtable offset from lookup start
  out.raw(subtable.toUint8Array());

  return out.toUint8Array();
}

/** One GSUB `liga` rule: component glyph indices → ligature glyph index. */
export interface LigaRule {
  components: readonly number[];
  ligature: number;
}

export interface GsubSinglePair {
  from: number;
  to: number;
}

export interface GsubAlternateSet {
  from: number;
  alts: readonly number[];
}

export interface GsubFeatures {
  liga?: readonly LigaRule[];
  /** Feature tag → 1:1 substitutions (`ss01`, `ss02`, …). */
  singles?: Readonly<Record<string, readonly GsubSinglePair[]>>;
  /** Alternate substitution (`salt`). */
  salt?: readonly GsubAlternateSet[];
}

function coverageFormat1(glyphs: readonly number[]): Uint8Array {
  const out = new ByteWriter();
  out.uint16(1);
  out.uint16(glyphs.length);
  for (const glyph of glyphs) {
    out.uint16(glyph);
  }
  return out.toUint8Array();
}

function wrapLookup(type: number, subtable: Uint8Array): Uint8Array {
  const lookup = new ByteWriter();
  lookup.uint16(type);
  lookup.uint16(0);
  lookup.uint16(1);
  lookup.uint16(8);
  lookup.raw(subtable);
  return lookup.toUint8Array();
}

function buildLigatureSubst(rules: readonly LigaRule[]): Uint8Array | null {
  const valid = rules.filter((rule) => rule.components.length >= 2);
  if (valid.length === 0) {
    return null;
  }

  const grouped = new Map<number, LigaRule[]>();
  for (const rule of valid) {
    const first = rule.components[0]!;
    const bucket = grouped.get(first);
    if (bucket) {
      bucket.push(rule);
    } else {
      grouped.set(first, [rule]);
    }
  }
  const firstGlyphs = [...grouped.keys()].sort((a, b) => a - b);

  const ligSets: Uint8Array[] = [];
  for (const firstGlyph of firstGlyphs) {
    const setRules = grouped.get(firstGlyph)!;
    const ligBodies: Uint8Array[] = [];
    for (const rule of setRules) {
      const lig = new ByteWriter();
      lig.uint16(rule.ligature);
      lig.uint16(rule.components.length);
      for (let i = 1; i < rule.components.length; i += 1) {
        lig.uint16(rule.components[i]!);
      }
      ligBodies.push(lig.toUint8Array());
    }
    const set = new ByteWriter();
    set.uint16(setRules.length);
    let cursor = 2 + 2 * setRules.length;
    for (const body of ligBodies) {
      set.uint16(cursor);
      cursor += body.length;
    }
    for (const body of ligBodies) {
      set.raw(body);
    }
    ligSets.push(set.toUint8Array());
  }

  const coverageBytes = coverageFormat1(firstGlyphs);
  const ligSetCount = firstGlyphs.length;
  const substHeaderSize = 6 + 2 * ligSetCount;
  const coverageOffset = substHeaderSize;
  let setCursor = coverageOffset + coverageBytes.length;
  const setOffsets: number[] = [];
  for (const setData of ligSets) {
    setOffsets.push(setCursor);
    setCursor += setData.length;
  }

  const subst = new ByteWriter();
  subst.uint16(1);
  subst.uint16(coverageOffset);
  subst.uint16(ligSetCount);
  for (const offset of setOffsets) {
    subst.uint16(offset);
  }
  subst.raw(coverageBytes);
  for (const setData of ligSets) {
    subst.raw(setData);
  }
  return subst.toUint8Array();
}

function buildSingleSubst(pairs: readonly GsubSinglePair[]): Uint8Array | null {
  if (pairs.length === 0) {
    return null;
  }
  const sorted = [...pairs].sort((a, b) => a.from - b.from);
  const coverageBytes = coverageFormat1(sorted.map((pair) => pair.from));
  const headerSize = 6 + 2 * sorted.length;
  const subst = new ByteWriter();
  subst.uint16(2);
  subst.uint16(headerSize);
  subst.uint16(sorted.length);
  for (const pair of sorted) {
    subst.uint16(pair.to);
  }
  subst.raw(coverageBytes);
  return subst.toUint8Array();
}

function buildAlternateSubst(sets: readonly GsubAlternateSet[]): Uint8Array | null {
  const valid = sets.filter((entry) => entry.alts.length > 0);
  if (valid.length === 0) {
    return null;
  }
  const sorted = [...valid].sort((a, b) => a.from - b.from);
  const altSets: Uint8Array[] = [];
  for (const entry of sorted) {
    const body = new ByteWriter();
    body.uint16(entry.alts.length);
    for (const glyph of entry.alts) {
      body.uint16(glyph);
    }
    altSets.push(body.toUint8Array());
  }
  const coverageBytes = coverageFormat1(sorted.map((entry) => entry.from));
  const headerSize = 6 + 2 * sorted.length;
  let cursor = headerSize + coverageBytes.length;
  const offsets: number[] = [];
  for (const body of altSets) {
    offsets.push(cursor);
    cursor += body.length;
  }
  const subst = new ByteWriter();
  subst.uint16(1);
  subst.uint16(headerSize);
  subst.uint16(sorted.length);
  for (const offset of offsets) {
    subst.uint16(offset);
  }
  subst.raw(coverageBytes);
  for (const body of altSets) {
    subst.raw(body);
  }
  return subst.toUint8Array();
}

/**
 * GSUB with `liga`, stylistic sets (`ss01`…) and `salt`.
 * Feature records are stored in tag order as the spec requires.
 */
export function buildGsubTable(features: GsubFeatures): Uint8Array | null {
  const lookups: Uint8Array[] = [];
  const featureLookups: Array<{ tag: string; lookup: number }> = [];

  const ligaSubst = features.liga ? buildLigatureSubst(features.liga) : null;
  if (ligaSubst) {
    featureLookups.push({ tag: 'liga', lookup: lookups.length });
    lookups.push(wrapLookup(4, ligaSubst));
  }

  for (const [tag, pairs] of Object.entries(features.singles ?? {})) {
    const subst = buildSingleSubst(pairs);
    if (!subst) {
      continue;
    }
    featureLookups.push({ tag, lookup: lookups.length });
    lookups.push(wrapLookup(1, subst));
  }

  const saltSubst = features.salt ? buildAlternateSubst(features.salt) : null;
  if (saltSubst) {
    featureLookups.push({ tag: 'salt', lookup: lookups.length });
    lookups.push(wrapLookup(3, saltSubst));
  }

  if (lookups.length === 0) {
    return null;
  }

  featureLookups.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const lookupList = new ByteWriter();
  lookupList.uint16(lookups.length);
  let lookupCursor = 2 + 2 * lookups.length;
  for (const lookup of lookups) {
    lookupList.uint16(lookupCursor);
    lookupCursor += lookup.length;
  }
  for (const lookup of lookups) {
    lookupList.raw(lookup);
  }
  const lookupListBytes = lookupList.toUint8Array();

  const featureCount = featureLookups.length;
  const featureRecordsSize = 2 + 6 * featureCount;
  const featureTableSize = 6;
  const featureList = new ByteWriter();
  featureList.uint16(featureCount);
  for (let i = 0; i < featureCount; i += 1) {
    featureList.tag(featureLookups[i]!.tag.padEnd(4, ' ').slice(0, 4));
    featureList.uint16(featureRecordsSize + i * featureTableSize);
  }
  for (const feature of featureLookups) {
    featureList.uint16(0);
    featureList.uint16(1);
    featureList.uint16(feature.lookup);
  }
  const featureListBytes = featureList.toUint8Array();

  const scriptList = new ByteWriter();
  scriptList.uint16(1);
  scriptList.tag('DFLT');
  scriptList.uint16(8);
  scriptList.uint16(4);
  scriptList.uint16(0);
  scriptList.uint16(0);
  scriptList.uint16(0xffff);
  scriptList.uint16(featureCount);
  for (let i = 0; i < featureCount; i += 1) {
    scriptList.uint16(i);
  }
  const scriptListBytes = scriptList.toUint8Array();

  const headerSize = 10;
  const scriptListOffset = headerSize;
  const featureListOffset = scriptListOffset + scriptListBytes.length;
  const lookupListOffset = featureListOffset + featureListBytes.length;

  const out = new ByteWriter();
  out.uint16(1);
  out.uint16(0);
  out.uint16(scriptListOffset);
  out.uint16(featureListOffset);
  out.uint16(lookupListOffset);
  out.raw(scriptListBytes);
  out.raw(featureListBytes);
  out.raw(lookupListBytes);
  return out.toUint8Array();
}

export function buildGsubLigaTable(rules: readonly LigaRule[]): Uint8Array | null {
  return buildGsubTable({ liga: rules });
}

/** Legacy horizontal `kern` table, format 0. */
export function buildLegacyKernTable(pairs: readonly KernPair[]): Uint8Array | null {
  if (pairs.length === 0) {
    return null;
  }
  const sorted = [...pairs].sort((a, b) => a.left - b.left || a.right - b.right);
  const nPairs = sorted.length;
  const power = 2 ** floorLog2(nPairs);

  const out = new ByteWriter();
  out.uint16(0); // table version
  out.uint16(1); // number of subtables
  out.uint16(0); // subtable version
  out.uint16(14 + 6 * nPairs); // subtable length
  out.uint16(0x0001); // coverage: horizontal kerning
  out.uint16(nPairs);
  out.uint16(power * 6); // searchRange
  out.uint16(floorLog2(nPairs)); // entrySelector
  out.uint16((nPairs - power) * 6); // rangeShift
  for (const pair of sorted) {
    out.uint16(pair.left);
    out.uint16(pair.right);
    out.int16(pair.value);
  }
  return out.toUint8Array();
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  const padded = data.length + ((4 - (data.length % 4)) % 4);
  for (let i = 0; i < padded; i += 4) {
    const word =
      ((data[i] ?? 0) << 24) |
      ((data[i + 1] ?? 0) << 16) |
      ((data[i + 2] ?? 0) << 8) |
      (data[i + 3] ?? 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum >>> 0;
}

interface TableEntry {
  tag: string;
  data: Uint8Array;
}

function readTables(font: Uint8Array): { version: string; tables: TableEntry[] } {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const version = String.fromCharCode(font[0], font[1], font[2], font[3]);
  const numTables = view.getUint16(4);
  const tables: TableEntry[] = [];

  for (let i = 0; i < numTables; i += 1) {
    const recordOffset = 12 + i * 16;
    const tag = String.fromCharCode(
      font[recordOffset],
      font[recordOffset + 1],
      font[recordOffset + 2],
      font[recordOffset + 3],
    );
    const offset = view.getUint32(recordOffset + 8);
    const length = view.getUint32(recordOffset + 12);
    tables.push({ tag, data: font.subarray(offset, offset + length) });
  }

  return { version, tables };
}

/**
 * Rebuild a font binary with extra tables added (existing tags are replaced),
 * recomputing the table directory, per-table checksums and
 * `head.checkSumAdjustment`.
 */
export function injectTables(
  fontBinary: ArrayBuffer,
  extras: ReadonlyArray<{ tag: string; data: Uint8Array }>,
): ArrayBuffer {
  const source = new Uint8Array(fontBinary);
  const { version, tables } = readTables(source);

  const replaced = new Set(extras.map((entry) => entry.tag));
  const merged: TableEntry[] = tables
    .filter((entry) => !replaced.has(entry.tag))
    .map((entry) => ({ tag: entry.tag, data: new Uint8Array(entry.data) }));

  for (const extra of extras) {
    merged.push({ tag: extra.tag, data: extra.data });
  }
  merged.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const head = merged.find((entry) => entry.tag === 'head');
  if (!head) {
    throw new Error('Шрифт без таблицы head — нечего пересобирать');
  }
  // Convention: the head checksum is computed with checkSumAdjustment zeroed.
  new DataView(head.data.buffer, head.data.byteOffset, head.data.byteLength).setUint32(
    8,
    0,
  );

  const numTables = merged.length;
  const power = 2 ** floorLog2(numTables);
  const directorySize = 12 + 16 * numTables;

  const offsets: number[] = [];
  let cursor = directorySize;
  for (const entry of merged) {
    offsets.push(cursor);
    cursor += entry.data.length;
    cursor += (4 - (cursor % 4)) % 4;
  }

  const out = new Uint8Array(cursor);
  const view = new DataView(out.buffer);

  for (let i = 0; i < 4; i += 1) {
    out[i] = version.charCodeAt(i);
  }
  view.setUint16(4, numTables);
  view.setUint16(6, power * 16);
  view.setUint16(8, floorLog2(numTables));
  view.setUint16(10, numTables * 16 - power * 16);

  merged.forEach((entry, i) => {
    const recordOffset = 12 + i * 16;
    for (let c = 0; c < 4; c += 1) {
      out[recordOffset + c] = entry.tag.charCodeAt(c);
    }
    view.setUint32(recordOffset + 4, checksum(entry.data));
    view.setUint32(recordOffset + 8, offsets[i]);
    view.setUint32(recordOffset + 12, entry.data.length);
    out.set(entry.data, offsets[i]);
  });

  const headIndex = merged.indexOf(head);
  const adjustment = (HEAD_CHECKSUM_MAGIC - checksum(out)) >>> 0;
  view.setUint32(offsets[headIndex] + 8, adjustment);

  return out.buffer;
}
