// Terminal display width helpers (simplified East Asian Width). Pure functions, no dependencies.
//
// Known limitations: emoji width differs between terminals and fonts, regional-indicator
// flags count as 1 per letter (2 per flag), and ZWJ sequences are only treated as one
// glyph (width 2) when every part is an Extended_Pictographic character.

const ELLIPSIS = "…";
const PICTOGRAPHIC = /^\p{Extended_Pictographic}$/u;
const MARK = /^\p{M}$/u;
// Control characters and invisible format characters (BOM, soft hyphen, bidi marks, tags...).
const CONTROL = /^[\p{Cc}\p{Cf}]$/u;

const WIDE_RANGES = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
  [0x20000, 0x3fffd],
];

const isZwj = (cp) => cp === 0x200d;
const isVariationSelector = (cp) => cp >= 0xfe00 && cp <= 0xfe0f;
const isSkinTone = (cp) => cp >= 0x1f3fb && cp <= 0x1f3ff;

// Width of one code point on its own (ignores sequence context).
function codePointWidth(ch) {
  const cp = ch.codePointAt(0);
  if (cp === 0x09) return 1; // tab counts as one space
  if (cp >= 0x200b && cp <= 0x200d) return 0;
  if (isVariationSelector(cp) || isSkinTone(cp)) return 0;
  if (CONTROL.test(ch) || MARK.test(ch)) return 0;
  for (const [lo, hi] of WIDE_RANGES) if (cp >= lo && cp <= hi) return 2;
  // Skip the Latin-1/punctuation block (copyright, registered mark) that terminals draw narrow.
  // Text-style pictographs with no U+FE0F (check mark, warning sign, trademark) still count as 2,
  // although many terminals draw them as 1; see the known limitations above.
  if (cp >= 0x2000 && PICTOGRAPHIC.test(ch)) return 2;
  return 1;
}

// Split a string into display units: a base code point plus the zero-width code points
// that attach to it (marks, variation selectors, ZWJ and the pictograph joined by it).
// Units are never split by truncation or wrapping.
function units(str) {
  const out = [];
  let joinable = false; // previous code point was a ZWJ attached to a pictographic unit
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    const last = out.at(-1);
    const pictographic = PICTOGRAPHIC.test(ch);
    if (last && joinable && pictographic) {
      last.text += ch;
      joinable = false;
      continue;
    }
    joinable = false;
    const w = codePointWidth(ch);
    if (last && w === 0) {
      last.text += ch;
      joinable = isZwj(cp) && last.pictographic;
    } else {
      out.push({ text: ch, width: w, pictographic });
    }
  }
  return out;
}

export function displayWidth(str) {
  let total = 0;
  for (const u of units(str)) total += u.width;
  return total;
}

// Fit `str` in `maxWidth` columns, ending with an ellipsis when it had to be cut.
export function truncateToWidth(str, maxWidth) {
  const text = String(str);
  if (displayWidth(text) <= maxWidth) return text;
  if (maxWidth < 1) return "";
  const budget = maxWidth - displayWidth(ELLIPSIS);
  let used = 0;
  let result = "";
  for (const u of units(text)) {
    if (used + u.width > budget) break;
    used += u.width;
    result += u.text;
  }
  return result + ELLIPSIS;
}

// Pad with spaces on the right up to `width` columns (never truncates).
export function padEndToWidth(str, width) {
  return String(str) + " ".repeat(Math.max(0, width - displayWidth(str)));
}

// Hard-split `str` into chunks of at most `maxWidth` columns on unit boundaries.
// Always makes progress, even if one unit is wider than maxWidth.
export function splitByWidth(str, maxWidth) {
  const chunks = [];
  let current = "";
  let used = 0;
  for (const u of units(str)) {
    if (current && used + u.width > maxWidth) {
      chunks.push(current);
      current = "";
      used = 0;
    }
    current += u.text;
    used += u.width;
  }
  if (current || !chunks.length) chunks.push(current);
  return chunks;
}
