import assert from 'node:assert/strict'
import test from 'node:test'
import { isDedicatedCodexResume, stopAgent } from '../server/stop.ts'

test('only a complete UUID argument in a dedicated resume command matches', () => {
  const id = '00000000-0000-0000-0000-000000000000'
  assert.equal(isDedicatedCodexResume(`codex.exe resume ${id}`, id), true)
  assert.equal(isDedicatedCodexResume(`"C:\\tools\\codex.exe" resume "${id}"`, id), true)
  for (const cmd of [`codex.exe app-server --thread ${id}`, `codex.exe app-server --note "resume ${id}"`, `codex.exe exec "resume ${id}"`, `codex.exe resume ${id}/guardian`, `codex.exe resume prefix-${id}`, `codex.exe resume ${id}suffix`]) {
    assert.equal(isDedicatedCodexResume(cmd, id), false)
  }
  assert.equal(isDedicatedCodexResume('codex.exe resume anything', '.*'), false)
  assert.equal(isDedicatedCodexResume(`codex.exe resume "${id}"/guardian`, id), false)
  assert.equal(isDedicatedCodexResume(`codex.exe resume "${id}`, id), false)
})

test('invalid process identifiers are rejected before any process lookup or termination', async () => {
  for (const id of ['cx:codex', 'cx:--', 'cx:x', 'cx:00000000-0000-0000-0000-000000000000/guardian', 'cc:short', 'cc:00000000-0000-0000-0000-000000000000/child']) {
    const result = await stopAgent(id)
    assert.equal(result.ok, false)
    assert.match(result.message, /invalid/i)
  }
})
