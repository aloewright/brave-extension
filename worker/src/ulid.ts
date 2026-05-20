// Crockford-base32 ULID. 48-bit timestamp + 80-bit randomness = 26 chars.
const ENCODE = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function ulid(now: number = Date.now()): string {
  if (now < 0 || now > 281474976710655) throw new Error("ulid: timestamp out of range")
  let time = now
  let timeChars = ""
  for (let i = 9; i >= 0; i--) {
    const mod = time % 32
    timeChars = ENCODE[mod] + timeChars
    time = (time - mod) / 32
  }
  let randomChars = ""
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  for (let i = 0; i < 16; i++) randomChars += ENCODE[bytes[i]! % 32]
  return timeChars + randomChars
}
