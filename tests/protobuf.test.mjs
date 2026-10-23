import assert from 'node:assert/strict'
import test from 'node:test'
import { fields, msg, num, str, time } from '../server/protobuf.ts'

// Hand-encoded: field 1 = "hi", field 2 = 300, field 7 = { 1: 1792614683, 2: 364921300 }, field 9 = { 2: 13697, 11: "r1" }
const enc = (...bytes) => Uint8Array.from(bytes.flat())
const varint = (n) => {
  const out = []
  do {
    let b = n % 128
    n = Math.floor(n / 128)
    if (n) b |= 128
    out.push(b)
  } while (n)
  return out
}
const len = (f, body) => [...varint(f * 8 + 2), ...varint(body.length), ...body]
const vi = (f, n) => [...varint(f * 8), ...varint(n)]
const text = (s) => [...Buffer.from(s)]

test('reads numbers, text, nested messages and timestamps', () => {
  const b = enc(len(1, text('hi')), vi(2, 300), len(7, [...vi(1, 1792614683), ...vi(2, 364921300)]), len(9, [...vi(2, 13697), ...len(11, text('r1'))]))
  const m = fields(b)
  assert.equal(str(m, 1), 'hi')
  assert.equal(num(m, 2), 300)
  assert.equal(time(m, 7), 1792614683364)
  assert.equal(num(msg(m, 9), 2), 13697)
  assert.equal(str(msg(m, 9), 11), 'r1')
})

test('missing fields and malformed data give empty values instead of throwing', () => {
  const m = fields(enc([0x0a, 0x05, 0x61]))
  assert.equal(str(m, 1), '')
  assert.equal(num(m, 4), 0)
  assert.equal(msg(m, 9).size, 0)
  assert.equal(fields(null).size, 0)
})
