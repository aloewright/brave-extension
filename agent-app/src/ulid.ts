// Crockford-base32 ULID. 48-bit timestamp + 80-bit randomness = 26 chars.
const ENCODE = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// Monotonic state so ids minted within the same millisecond still sort in
// creation order — this is what makes `ORDER BY created_at ASC, id ASC` a stable
// tiebreaker for same-millisecond inserts.
let lastTime = -1
let lastRandom: number[] = []

export function ulid(now: number = Date.now()): string {
  if (now < 0 || now > 281474976710655) throw new Error("ulid: timestamp out of range")
  let time = now
  let timeChars = ""
  for (let i = 9; i >= 0; i--) {
    const mod = time % 32
    timeChars = ENCODE[mod] + timeChars
    time = (time - mod) / 32
  }

  let random: number[]
  if (now === lastTime && lastRandom.length === 16) {
    // Same millisecond: increment the previous randomness (base-32, big-endian)
    // so the new id is strictly greater than the last one.
    random = lastRandom.slice()
    for (let i = 15; i >= 0; i--) {
      if (random[i]! < 31) {
        random[i]!++
        break
      }
      random[i] = 0
    }
  } else {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    random = Array.from(bytes, (b) => b % 32)
  }
  lastTime = now
  lastRandom = random

  let randomChars = ""
  for (let i = 0; i < 16; i++) randomChars += ENCODE[random[i]!]
  return timeChars + randomChars
}
