// VP8's boolean entropy decoder (RFC 6386 7), as libwebp's: read a byte at a time, and past the end of its data it
// reads zeros and says so (`eof`), the frame then cut short.

export class BoolDecoder {
  private readonly buf: Uint8Array
  private at: number
  private readonly end: number
  /** The bits read and not yet consumed: `bits + 8` of them, the top 8 compared with the range. */
  private value = 0
  /** The range less 1, in [127, 254] between calls. */
  private range = 254
  private bits = -8
  /** Whether it read past its data. */
  eof = false

  constructor(buf: Uint8Array, start: number, end: number) {
    this.buf = buf
    this.at = start
    this.end = end
    this.load()
  }

  private load() {
    if (this.at < this.end) { this.bits += 8; this.value = (this.value << 8) | this.buf[this.at++] }
    else if (!this.eof) { this.value <<= 8; this.bits += 8; this.eof = true }
    else this.bits = 0
  }

  /** One bit, 1 with probability `1 - prob / 256`. */
  bit(prob: number): number {
    let range = this.range
    if (this.bits < 0) this.load()
    const pos = this.bits, split = (range * prob) >> 8
    let bit = 0
    if (this.value >>> pos > split) { range -= split; this.value -= (split + 1) << pos; bit = 1 }
    else range = split + 1
    const shift = 7 ^ (31 - Math.clz32(range))
    this.range = (range << shift) - 1
    this.bits -= shift
    return bit
  }

  /** An `n`-bit unsigned literal, most significant bit first. */
  literal(n: number): number {
    let v = 0
    while (n-- > 0) v |= this.bit(0x80) << n
    return v
  }

  /** An `n`-bit magnitude, then its sign. */
  signed(n: number): number {
    const v = this.literal(n)
    return this.bit(0x80) ? -v : v
  }

  /** `n` bits if a flag bit says they're there, else 0. */
  maybeSigned(n: number): number {
    return this.bit(0x80) ? this.signed(n) : 0
  }
}
