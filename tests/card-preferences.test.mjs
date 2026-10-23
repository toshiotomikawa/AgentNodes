import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCardPreferences, normalizeColor, parseCardPreferences } from '../src/agent-tree/card-preferences.ts'

test('color input accepts short and full hex and rejects CSS or invalid values', () => {
  assert.equal(normalizeColor('#AbC'), '#aabbcc')
  assert.equal(normalizeColor(' 123ABC '), '#123abc')
  for (const value of ['', '#abcd', 'red', 'url(x)', '#gggggg']) assert.equal(normalizeColor(value), undefined)
})

test('card preferences survive JSON round trip and tolerate invalid stored values', () => {
  const prefs = { one: { color: '#123abc', doneAt: 12345 } }
  assert.deepEqual(parseCardPreferences(JSON.stringify(prefs)), prefs)
  for (const raw of ['null', '[]', 'broken']) assert.deepEqual(parseCardPreferences(raw), {})
  assert.deepEqual(parseCardPreferences('{"one":{"color":"url(x)","doneAt":-1}}'), {})
})

test('marking done changes presentation without mutating source; undo restores live state', () => {
  const source = { id: 'one', status: 'running', startedAt: 100, issue: { message: 'Waiting' } }
  const [done] = applyCardPreferences([source], { one: { color: '#123abc', doneAt: 200 } })
  assert.equal(done.status, 'done')
  assert.equal(done.endedAt, 200)
  assert.equal(done.issue, undefined)
  assert.equal(done.markedDone, true)
  assert.equal(source.status, 'running')
  assert.equal(applyCardPreferences([source], {})[0], source)
  assert.equal(applyCardPreferences([source], { one: { color: '#123abc' } })[0].status, 'running')
})

test('mark as closed survives a round trip, flags the card closed and ends a waiting session', () => {
  const prefs = parseCardPreferences(JSON.stringify({ one: { closedAt: 300 } }))
  assert.deepEqual(prefs, { one: { color: undefined, doneAt: undefined, closedAt: 300 } })
  const [card] = applyCardPreferences([{ id: 'one', startedAt: 100, status: 'needs-you', issue: { message: 'x' } }], prefs)
  assert.equal(card.closed, true)
  assert.equal(card.markedClosed, true)
  assert.equal(card.status, 'done')
  assert.equal(card.endedAt, 300)
  assert.equal(card.issue, undefined)
})
