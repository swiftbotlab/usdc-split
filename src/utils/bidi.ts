/**
 * Sanitise untrusted on-chain text (labels, memos) before rendering.
 * - Never renders as HTML or creates links.
 * - Bidi / zero-width / invisible Unicode codepoints are replaced with visible escapes.
 */

const DANGEROUS_RANGES: [number, number][] = [
  [0x202a, 0x202e], // LRE RLE PDF LRO RLO
  [0x2066, 0x2069], // LRI RLI FSI PDI
  [0x200b, 0x200f], // ZWSP ZWJ ZWNJ LRM RLM
  [0xfeff, 0xfeff], // BOM / ZWNBSP
]

function isDangerous(cp: number): boolean {
  return DANGEROUS_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)
}

/** Return a displayable string with dangerous codepoints replaced by U+XXXX escapes. */
export function sanitiseText(raw: string): string {
  let out = ''
  for (const char of raw) {
    const cp = char.codePointAt(0) ?? 0
    if (isDangerous(cp)) {
      out += `[U+${cp.toString(16).toUpperCase().padStart(4, '0')}]`
    } else {
      out += char
    }
  }
  return out
}
