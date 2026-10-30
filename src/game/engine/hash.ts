/** Deterministic FNV-1a, 64-bit-looking hex. Not a real SHA-256; the teaching is content addressing. */
export function digestOf(...parts: string[]): string {
  const s = parts.join('\u001f')
  let h1 = 2166136261
  let h2 = 2166136261
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i)
    h1 = Math.imul(h1, 16777619)
    h2 ^= s.charCodeAt(s.length - 1 - i)
    h2 = Math.imul(h2, 16777619)
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

export function shortDigest(digest: string): string {
  return digest.slice(0, 8)
}
