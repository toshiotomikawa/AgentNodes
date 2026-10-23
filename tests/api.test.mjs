import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { createLocalMiddleware } from '../server/api.ts'

test('loopback API rejects hostile browser requests before invoking any service', async () => {
  const calls = { read: 0, stop: 0, quit: 0 }
  const middleware = createLocalMiddleware({
    snapshot: () => { calls.read++; return { agents: [{ id: 'synthetic-session' }] } },
    stop: async () => { calls.stop++; return { ok: true, message: 'Fixture only.' } },
    quit: () => { calls.quit++ },
  })
  const server = http.createServer((req, res) => { void middleware(req, res, () => { res.statusCode = 404; res.end() }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const origin = `http://127.0.0.1:${port}`
  const request = (path, method = 'GET', headers = {}, body) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      let text = ''; res.on('data', c => { text += c }); res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }))
    }); req.on('error', reject); req.end(body)
  })
  try {
    const hostile = [
      ['/api/agents', 'GET', {}],
      ['/api/agents', 'GET', { 'x-agent-nodes': '1', host: `attacker.example:${port}` }],
      ['/api/agents', 'GET', { 'x-agent-nodes': '1', origin: 'https://attacker.example' }],
      ['/api/agents', 'GET', { 'x-agent-nodes': '1', 'sec-fetch-site': 'cross-site' }],
      ['/api/agents', 'OPTIONS', { origin: 'https://attacker.example', 'access-control-request-headers': 'x-agent-nodes' }],
      ['/api/agents', 'POST', { 'x-agent-nodes': '1' }],
      ['/api/stop', 'POST', { 'x-agent-nodes': '1' }],
      ['/api/stop', 'POST', { 'x-agent-nodes': '1', origin: `http://localhost:${port}` }],
      ['/api/quit', 'POST', { origin: 'https://attacker.example' }],
    ]
    for (const args of hostile) {
      const r = await request(...args)
      assert.equal(r.status, 403)
      assert.ok(!r.text.includes('synthetic-session'))
      assert.equal(r.headers['access-control-allow-origin'], undefined)
    }
    assert.deepEqual(calls, { read: 0, stop: 0, quit: 0 })
    const valid = { 'x-agent-nodes': '1', origin, 'sec-fetch-site': 'same-origin' }
    const read = await request('/api/agents', 'GET', valid)
    assert.equal(read.status, 200)
    assert.equal(read.headers['cache-control'], 'no-store')
    assert.equal(JSON.parse(read.text).agents[0].id, 'synthetic-session')
    assert.equal((await request('/api/stop', 'POST', valid, '{')).status, 400)
    assert.equal((await request('/api/stop', 'POST', valid, 'x'.repeat(20_000))).status, 400)
    assert.equal(calls.stop, 0)
    assert.equal((await request('/api/stop', 'POST', valid, JSON.stringify({ id: 'fixture' }))).status, 200)
    assert.equal((await request('/api/quit', 'POST', valid)).status, 200)
    assert.deepEqual(calls, { read: 1, stop: 1, quit: 1 })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('unexpected service errors never disclose exception contents', async () => {
  const middleware = createLocalMiddleware({ snapshot: () => { throw new Error('DUMMY_PRIVATE_PATH') }, stop: async () => { throw new Error('DUMMY_PRIVATE_PASSWORD') }, quit: () => {} })
  const server = http.createServer((req, res) => { void middleware(req, res, () => res.end()) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    for (const path of ['agents', 'stop']) {
      const r = await fetch(`${origin}/api/${path}`, { method: path === 'stop' ? 'POST' : 'GET', headers: { 'x-agent-nodes': '1', origin }, body: path === 'stop' ? '{"id":"fixture"}' : undefined })
      assert.equal(r.status, 500)
      assert.ok(!(await r.text()).includes('DUMMY_PRIVATE'))
    }
  } finally { await new Promise(resolve => server.close(resolve)) }
})
