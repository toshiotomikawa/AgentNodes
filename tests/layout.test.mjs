import assert from 'node:assert/strict'
import test from 'node:test'
import { CARD_H, layoutForest } from '../src/agent-tree/layout.ts'

const node = (id, children = []) => ({ agent: { id, status: 'done' }, children })
const forest = () => [
  node('one'), node('two'), node('three'), node('four', [node('four-child')]),
  node('sandbox', [node('general')]), node('six'), node('seven'), node('eight'),
  node('nine', [node('nine-child')]), node('ten'), node('eleven'), node('twelve'),
]
const expand = (roots, width, ids) => layoutForest(roots, width,
  n => ids.has(n.agent.id) ? 416 : CARD_H,
  (n, base) => ids.has(n.agent.id) ? base * 2 + 40 : base)

function separated(layout) {
  const cards = [...layout.cards.values()]
  for (const [i, a] of cards.entries()) {
    assert.ok(a.x >= 0 && a.y >= 0)
    assert.ok(a.x + a.w <= layout.width + 0.001)
    assert.ok(a.y + a.h <= layout.height + 0.001)
    for (const b of cards.slice(i + 1)) {
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y,
        'cards must not overlap')
    }
  }
}

test('vertical growth moves only cards below it, without changing their columns', () => {
  const roots = forest()
  const before = layoutForest(roots, 1524)
  const after = layoutForest(roots, 1524, n => n.agent.id === 'four' ? 449 : CARD_H)
  for (const [id, box] of before.cards) assert.equal(after.cards.get(id).x, box.x)
  // Trees pack into the highest free columns, so 'twelve' is the one under 'four'.
  assert.ok(after.cards.get('twelve').y > before.cards.get('twelve').y)
  assert.deepEqual(after.cards.get('nine'), before.cards.get('nine'))
  assert.deepEqual(after.cards.get('six'), before.cards.get('six'))
  separated(after)
})

test('width growth pushes the right neighbor by the exact number of pixels', () => {
  const roots = forest()
  const before = layoutForest(roots, 1524)
  const after = layoutForest(roots, 1524, () => CARD_H, (n, base) => n.agent.id === 'four' ? base + 73 : base)
  assert.ok(Math.abs(after.cards.get('sandbox').x - before.cards.get('sandbox').x - 73) < 0.001)
  assert.equal(after.cards.get('sandbox').y, before.cards.get('sandbox').y)
  assert.equal(after.cards.get('nine').x, before.cards.get('nine').x)
  separated(after)
})

test('combined width and height expansion keeps the lower card in its column', () => {
  const roots = forest()
  const before = layoutForest(roots, 1524)
  const after = expand(roots, 1524, new Set(['four']))
  assert.equal(after.cards.get('twelve').x, before.cards.get('twelve').x)
  assert.ok(after.cards.get('twelve').y > before.cards.get('twelve').y)
  assert.equal(after.cards.get('four-child').x, before.cards.get('four-child').x)
  assert.deepEqual(after.cards.get('eight'), before.cards.get('eight'))
  separated(after)
})

test('an expanded descendant does not reserve its width beside the whole tree', () => {
  const roots = [node('a', [node('child')]), node('b')]
  const before = layoutForest(roots, 940)
  const after = expand(roots, 940, new Set(['child']))
  assert.deepEqual(after.cards.get('b'), before.cards.get('b'))
  separated(after)
})

test('multiple root and descendant expansions stay separated and restore on collapse', () => {
  const roots = [
    node('a', [node('b', [node('c')]), node('d')]),
    node('e', [node('f')]), node('g'), node('h'),
  ]
  const ids = ['a','b','c','d','e','f','g','h']
  for (const width of [264, 568, 940, 1524]) {
    const before = layoutForest(roots, width)
    for (let mask = 0; mask < 2 ** ids.length; mask++) {
      const open = new Set(ids.filter((_, i) => mask & 2 ** i))
      separated(expand(roots, width, open))
    }
    assert.deepEqual(expand(roots, width, new Set()), before)
  }
})

test('a short tree fills the hole under a short neighbor instead of waiting below a tall one', () => {
  const roots = [node('a'), node('b', [node('b-child')]), node('c')]
  const l = layoutForest(roots, 568)
  assert.equal(l.cards.get('c').x, l.cards.get('a').x)
  assert.ok(l.cards.get('c').y < l.cards.get('b-child').y + CARD_H)
  separated(l)
})

test('a fork sits right beside the tree it came from, joined by a link', () => {
  const fork = { agent: { id: 'side', status: 'done', forkOf: 'origin' }, children: [] }
  const roots = [node('first'), node('origin', [node('a'), node('b')]), node('third'), fork]
  const layout = layoutForest(roots, 1524)
  separated(layout)
  const origin = layout.cards.get('origin')
  const side = layout.cards.get('side')
  assert.equal(side.y, origin.y)
  assert.ok(side.x > origin.x + origin.w)
  assert.equal(layout.links.length, 1)
  assert.equal(layout.links[0].id, 'side')
})

test('a session that talked agent-to-agent sits just left of the other, joined once', () => {
  const peer = { agent: { id: 'peer', status: 'running', peers: ['talker'] }, children: [] }
  const talker = { agent: { id: 'talker', status: 'done', peers: ['peer'] }, children: [node('kid')] }
  // Three columns: the pair cannot fit after the first two trees, so it starts a new row together.
  const layout = layoutForest([node('first'), node('second'), talker, peer], 860)
  separated(layout)
  const a = layout.cards.get('talker')
  const b = layout.cards.get('peer')
  assert.equal(a.y, b.y)
  assert.ok(b.x < a.x && b.x + b.w + 40 >= a.x)
  assert.deepEqual(layout.links.map((l) => l.id), ['peer:peer|talker'])
})
