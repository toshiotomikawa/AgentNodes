import assert from 'node:assert/strict'
import test from 'node:test'
import { CARD_H, layoutAgeGroups } from '../src/agent-tree/layout.ts'

const hour = 3600_000
const now = 30 * 24 * hour
const node = (id, age, children = []) => ({ agent: { id, startedAt: now - age, status: 'done' }, children })

test('age boundaries move whole trees into day, week and older sections', () => {
  const roots = [node('recent', hour - 1), node('day', hour, [node('child', hour)]), node('week', 24 * hour), node('old', 7 * 24 * hour)]
  const result = layoutAgeGroups(roots, 1000, now)
  assert.deepEqual(result.sections.map(s => s.label), ['Recent', 'One hour', 'One day', 'One week'])
  for (const [i, id] of ['recent', 'day', 'week', 'old'].entries()) {
    const box = result.cards.get(id)
    assert.ok(box.y > result.sections[i].y)
    if (i < 3) assert.ok(box.y + box.h < result.sections[i + 1].y)
  }
  assert.ok(result.cards.get('child').y > result.cards.get('day').y)
  assert.ok(result.cards.get('child').y + CARD_H < result.sections[2].y)
  assert.equal(result.edges[0].offsetY, result.sections[1].y + 36)
  const later = layoutAgeGroups(roots, 1000, now + 1)
  assert.deepEqual(later.sections.map(s => s.label), ['One hour', 'One day', 'One week'])
  assert.equal(later.cards.size, 5)
})

test('expansion leaves enough space before the following divider and empty bands disappear', () => {
  const roots = [node('one', 0), node('two', 24 * hour)]
  const result = layoutAgeGroups(roots, 1000, now, n => n.agent.id === 'one' ? 500 : CARD_H)
  assert.deepEqual(result.sections.map(s => s.label), ['Recent', 'One day'])
  assert.ok(result.cards.get('one').y + 500 < result.sections[1].y)
  assert.ok(result.cards.get('two').y > result.sections[1].y)
  assert.equal(layoutAgeGroups([], 1000, now).sections.length, 0)
})

test('trees closed here, marked closed or closed in their app share one Closed section, last', () => {
  const ended = node('ended', 0)
  ended.agent.ended = true
  const closed = node('closed', 0)
  closed.agent.closed = true
  const result = layoutAgeGroups([ended, closed, node('open', 0), node('old', 30 * 24 * hour)], 1000, now)
  assert.deepEqual(result.sections.map(s => s.label), ['Recent', 'One week', 'Closed'])
  assert.ok(result.cards.get('ended').y > result.sections[2].y)
  assert.ok(result.cards.get('closed').y > result.sections[2].y)
})

test('a tree is grouped by its latest activity, not by when it started', () => {
  const old = node('old', 3 * 24 * hour)
  old.agent.activeAt = now - 5 * 60_000
  const running = node('running', 30 * 24 * hour)
  running.agent.status = 'running'
  const busyChild = node('parent', 30 * 24 * hour, [node('kid', 0)])
  busyChild.children[0].agent.endedAt = now - 60_000
  const result = layoutAgeGroups([old, running, busyChild], 1000, now)
  assert.deepEqual(result.sections.map(s => s.label), ['Recent'])
})
