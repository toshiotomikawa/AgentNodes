/**
 * A minimal protobuf wire-format reader, enough to pick known fields out of Antigravity's blobs
 * without its schema. Unknown or malformed data yields empty results rather than throwing.
 */
export type Fields = Map<number, (number | Uint8Array)[]>

function varint(b: Uint8Array, i: number): [number, number] {
  let v = 0
  let mul = 1
  for (;;) {
    if (i >= b.length) throw new RangeError('truncated varint')
    const x = b[i++]
    v += (x & 127) * mul
    mul *= 128
    if (!(x & 128)) return [v, i]
  }
}

/** Every field in one message, by number. Length-delimited values stay raw, to be read as text or as a message. */
export function fields(b: Uint8Array | undefined | null): Fields {
  const out: Fields = new Map()
  if (!b) return out
  let i = 0
  try {
    while (i < b.length) {
      let key: number
      ;[key, i] = varint(b, i)
      const f = Math.floor(key / 8)
      const t = key & 7
      let v: number | Uint8Array
      if (t === 0) [v, i] = varint(b, i)
      else if (t === 1) (v = b.subarray(i, i + 8)), (i += 8)
      else if (t === 5) (v = b.subarray(i, i + 4)), (i += 4)
      else if (t === 2) {
        let len: number
        ;[len, i] = varint(b, i)
        v = b.subarray(i, i + len)
        i += len
      } else break
      if (i > b.length) break
      out.set(f, [...(out.get(f) ?? []), v])
    }
  } catch {}
  return out
}

/** The first value of field `f` as a number, or 0. */
export function num(m: Fields, f: number): number {
  const v = m.get(f)?.[0]
  return typeof v === 'number' ? v : 0
}

/** The first value of field `f` as text, or ''. */
export function str(m: Fields, f: number): string {
  const v = m.get(f)?.[0]
  return v instanceof Uint8Array ? Buffer.from(v).toString('utf8') : ''
}

/** The first value of field `f` read as a nested message. */
export function msg(m: Fields, f: number): Fields {
  const v = m.get(f)?.[0]
  return fields(v instanceof Uint8Array ? v : null)
}

/** A google.protobuf.Timestamp field as epoch ms, or 0. */
export function time(m: Fields, f: number): number {
  const t = msg(m, f)
  return num(t, 1) * 1000 + Math.floor(num(t, 2) / 1e6)
}
