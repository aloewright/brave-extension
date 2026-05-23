// Crockford's base32 (no I, L, O, U)
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const TIME_LEN = 10
const RAND_LEN = 16

function encodeTime(now: number, len: number): string {
  let out = ""
  for (let i = len - 1; i >= 0; i--) {
    out = ENCODING[now % 32] + out
    now = Math.floor(now / 32)
  }
  return out
}

function encodeRandom(len: number): string {
  // Use crypto where available, else Math.random fallback.
  const buf = new Uint8Array(len)
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(buf)
  } else {
    for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  let out = ""
  for (let i = 0; i < len; i++) out += ENCODING[buf[i] % 32]
  return out
}

export function ulid(now: number = Date.now()): string {
  return encodeTime(now, TIME_LEN) + encodeRandom(RAND_LEN)
}
