// Minimal, dependency-free PDF writer for a plain-text CV: A4, Helvetica / Helvetica-Bold (standard 14 fonts,
// nothing embedded), word wrap with hanging indents for bullets, multi-page, page numbers.
// Standard fonts use WinAnsiEncoding, which has no Cyrillic: Cyrillic is transliterated, other unsupported
// characters are mapped to close ASCII equivalents, so the text stays readable instead of turning into boxes.

/** Hard limits: a stored CV is user/AI-controlled text, so the renderer must stay cheap whatever it contains. */
export const MAX_INPUT_CHARS = 40_000;
export const MAX_PAGES = 30;

const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN_X = 56, MARGIN_TOP = 60, MARGIN_BOTTOM = 60;
const BODY = 10.2, LEADING = 14.6;

// Helvetica AFM widths (1/1000 em) for ASCII 32..126.
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
// WinAnsi high bytes we emit, with widths (same for both weights, close enough for layout).
const HIGH: Record<number, number> = { 0x80: 556, 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0xa0: 278, 0xa9: 737, 0xab: 556, 0xb0: 400, 0xb7: 278, 0xbb: 556, 0xd7: 584 };

const UNICODE_TO_WINANSI: Record<string, number> = {
  "€": 0x80, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  " ": 0x20, "©": 0xa9, "«": 0xab, "°": 0xb0, "·": 0xb7, "»": 0xbb, "×": 0xd7,
};
const ASCII_FALLBACK: Record<string, string> = {
  "→": "->", "←": "<-", "↑": "^", "↓": "v", "≥": ">=", "≤": "<=", "≈": "~", "₸": "KZT", "№": "No.", "✓": "+", "✔": "+", "✕": "x", "✗": "x",
  "‑": "-", "−": "-", "‐": "-", " ": " ", " ": " ", "​": "", "\t": "    ",
};
const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  // Kazakh
  ә: "a", ғ: "g", қ: "q", ң: "n", ө: "o", ұ: "u", ү: "u", һ: "h", і: "i",
  // Ukrainian / Belarusian
  є: "ye", ї: "yi", ґ: "g", ў: "u",
};

/** Unicode text → WinAnsi byte codes (Latin-1 range passes through; Cyrillic is transliterated). */
export function toWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x20 && cp <= 0x7e) { out.push(cp); continue; }
    if (UNICODE_TO_WINANSI[ch] != null) { out.push(UNICODE_TO_WINANSI[ch]); continue; }
    if (cp >= 0xa1 && cp <= 0xff) { out.push(cp); continue; } // Latin-1 letters (é, ü, ñ…) exist in WinAnsi
    let rep = ASCII_FALLBACK[ch];
    if (rep == null) {
      const lower = ch.toLowerCase();
      const t = CYR[lower];
      if (t != null) rep = ch !== lower && t ? t[0].toUpperCase() + t.slice(1) : t;
    }
    if (rep == null) {
      // Strip accents from anything else in Latin Extended, else a visible placeholder.
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      rep = /^[\x20-\x7e]+$/.test(base) ? base : "?";
    }
    for (const c of rep) out.push(c.charCodeAt(0));
  }
  return out;
}

const charW = (c: number, table: number[]) => (c >= 32 && c <= 126 ? table[c - 32] : HIGH[c] ?? (c >= 0xc0 ? 611 : 556));

const width = (codes: number[], size: number, bold = false) => {
  const table = bold ? W_BOLD : W_REG;
  let w = 0;
  for (const c of codes) w += charW(c, table);
  return (w * size) / 1000;
};

type Line = { codes: number[]; x: number; size: number; bold: boolean; gray?: boolean; gapBefore: number };
type Placed = Line & { y: number };

const BULLET = /^(\s*)([•\-*–]|\d+\.)\s+/;
const isHeading = (s: string) => /^[A-Z][A-Z &/+-]{2,}$/.test(s.trim()) && s.trim().length <= 40;

/**
 * Greedy word wrap on WinAnsi codes, linear in the input length. Words longer than the line are hard-broken
 * in a single pass over their characters (no re-measuring of prefixes, no repeated slicing).
 */
export function wrap(codes: number[], maxW: number, size: number, bold: boolean): number[][] {
  const table = bold ? W_BOLD : W_REG;
  const limit = (maxW * 1000) / size; // in font units, so each char costs one table lookup
  const space = charW(32, table);
  const lines: number[][] = [];
  let line: number[] = [];
  let lw = 0;
  const flush = () => { lines.push(line); line = []; lw = 0; };
  let i = 0;
  const n = codes.length;
  while (i <= n) {
    // next word: [i, j)
    let j = i;
    let ww = 0;
    while (j < n && codes[j] !== 32) ww += charW(codes[j++], table);
    if (ww > limit) {
      // Hard-break the long word into full-width chunks; the last chunk stays open for the following words.
      if (line.length) flush();
      let k = i;
      let cw = 0;
      let start = i;
      for (; k < j; k++) {
        const w = charW(codes[k], table);
        if (cw + w > limit && k > start) { lines.push(codes.slice(start, k)); start = k; cw = 0; }
        cw += w;
      }
      line = codes.slice(start, j);
      lw = cw;
    } else {
      if (line.length && lw + space + ww > limit) flush();
      if (line.length) { line.push(32); lw += space; }
      for (let k = i; k < j; k++) line.push(codes[k]);
      lw += ww;
    }
    i = j + 1;
  }
  lines.push(line);
  return lines;
}

/** Lays the CV out: first line is the name (large, bold); ALL-CAPS lines are section headings; bullets hang-indent. */
function layout(text: string): Placed[][] {
  const maxW = PAGE_W - MARGIN_X * 2;
  const src = text.replace(/\r\n?/g, "\n").split("\n");
  // Stop producing lines once we have far more than MAX_PAGES can hold (keeps layout bounded too).
  const maxLines = MAX_PAGES * Math.ceil((PAGE_H - MARGIN_TOP - MARGIN_BOTTOM) / LEADING) + 1;
  const out: Line[] = [];
  let first = true;
  let blank = false;
  for (const raw of src) {
    if (out.length > maxLines) break;
    if (!raw.trim()) { blank = true; continue; }
    const gap = blank ? 7 : 0;
    blank = false;
    if (first) {
      out.push({ codes: toWinAnsi(raw.trim()), x: MARGIN_X, size: 18, bold: true, gapBefore: 0 });
      first = false;
      continue;
    }
    if (isHeading(raw)) {
      out.push({ codes: toWinAnsi(raw.trim()), x: MARGIN_X, size: 9.2, bold: true, gray: true, gapBefore: Math.max(gap, 9) });
      continue;
    }
    const m = BULLET.exec(raw);
    if (m) {
      const indent = Math.min(24, m[1].length * 3);
      const marker = toWinAnsi(m[2] === "-" || m[2] === "*" || m[2] === "–" ? "•" : m[2]);
      const body = toWinAnsi(raw.slice(m[0].length).trim());
      const x = MARGIN_X + indent;
      const hang = width(marker, BODY) + 6;
      const lines = wrap(body, maxW - indent - hang, BODY, false);
      lines.forEach((l, i) => {
        out.push({ codes: i === 0 ? [...marker, 32, ...l] : l, x: i === 0 ? x : x + hang, size: BODY, bold: false, gapBefore: i === 0 ? gap : 0 });
      });
      continue;
    }
    // Plain line; a short line followed by a date range reads as an entry title → bold.
    const lead = raw.length - raw.trimStart().length;
    const codes = toWinAnsi(raw.trim());
    const entry = /\(\s*[A-Za-z]{3,}\.?\s*\d{4}|\(\d{4}/.test(raw) && raw.trim().length < 120;
    const x = MARGIN_X + Math.min(24, lead * 3);
    wrap(codes, maxW - (x - MARGIN_X), BODY, entry).forEach((l, i) => out.push({ codes: l, x, size: BODY, bold: entry, gapBefore: i === 0 ? gap : 0 }));
  }
  // Paginate (capped at MAX_PAGES; the rest is dropped with a visible note)
  const pages: Placed[][] = [[]];
  let y = PAGE_H - MARGIN_TOP;
  for (const l of out) {
    const lh = l.size > 12 ? l.size * 1.3 : LEADING;
    let gap = l.gapBefore;
    if (y - gap - lh < MARGIN_BOTTOM && pages[pages.length - 1].length) {
      if (pages.length >= MAX_PAGES) {
        const last = pages[pages.length - 1];
        last[last.length - 1] = { codes: toWinAnsi("[...] truncated"), x: MARGIN_X, size: BODY, bold: false, gray: true, gapBefore: 0, y: last[last.length - 1].y };
        break;
      }
      pages.push([]); y = PAGE_H - MARGIN_TOP; gap = 0;
    }
    y -= gap + lh;
    pages[pages.length - 1].push({ ...l, y });
  }
  return pages;
}

const pdfString = (codes: number[]) => {
  let s = "(";
  for (const c of codes) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += "\\" + String.fromCharCode(c);
    else if (c < 32 || c > 126) s += "\\" + c.toString(8).padStart(3, "0");
    else s += String.fromCharCode(c);
  }
  return s + ")";
};

/** Renders plain text to a PDF document (bytes). Pure ASCII output, so byte offsets equal string offsets. */
export function textToPdf(text: string, meta: { title: string; footer?: string }): Uint8Array {
  const clipped = text.length > MAX_INPUT_CHARS ? `${text.slice(0, MAX_INPUT_CHARS)}\n\n[...] truncated` : text;
  const pages = layout(clipped || " ");
  const objs: string[] = [];
  const add = (body: string) => { objs.push(body); return objs.length; };

  const catalog = add(""); // placeholder, filled below
  const pagesId = add("");
  const fReg = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  pages.forEach((lines, pi) => {
    let stream = "";
    for (const l of lines) {
      const color = l.gray ? "0.27 0.38 0.40 rg" : "0.08 0.08 0.08 rg";
      stream += `BT ${color} /${l.bold ? "F2" : "F1"} ${l.size} Tf ${l.x.toFixed(2)} ${l.y.toFixed(2)} Td ${pdfString(l.codes)} Tj ET\n`;
    }
    const foot = toWinAnsi(`${meta.footer ? `${meta.footer.slice(0, 120)}  ·  ` : ""}${pi + 1} / ${pages.length}`);
    stream += `BT 0.55 0.55 0.55 rg /F1 7.5 Tf ${(PAGE_W - MARGIN_X - width(foot, 7.5)).toFixed(2)} 32 Td ${pdfString(foot)} Tj ET\n`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fReg} 0 R /F2 ${fBold} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const info = add(`<< /Title ${pdfString(toWinAnsi(meta.title.slice(0, 200)))} /Producer (Simplify) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z) >>`);

  let out = "%PDF-1.4\n"; // the whole file is ASCII (high bytes are octal-escaped), so string length = byte offset
  const offsets: number[] = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
