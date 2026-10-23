import type { IncomingMessage, ServerResponse } from 'node:http'

interface Services {
  snapshot: (url: URL) => unknown
  stop: (id: string) => Promise<{ ok: boolean; message: string }>
  quit: () => void
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(body))
}

/** Independent of Vite's later host check: plugin middleware runs before it. */
function localRequest(req: IncomingMessage) {
  const peer = req.socket.remoteAddress
  if (!peer || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) return false
  const port = req.socket.localPort
  return !!port && [`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host ?? '')
}

function allowedApiRequest(req: IncomingMessage, write: boolean) {
  const origin = req.headers.origin
  const site = req.headers['sec-fetch-site']
  return req.headers['x-agent-nodes'] === '1'
    && (!origin || origin === `http://${req.headers.host}`)
    && (!write || !!origin)
    && (!site || site === 'same-origin' || site === 'none')
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 10_000) {
        tooLarge = true
        chunks.length = 0
        reject(new Error('body limit'))
      } else if (!tooLarge) chunks.push(chunk)
    })
    req.on('end', () => { if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
    req.on('aborted', () => reject(new Error('aborted')))
  })
}

/** Services are injected so tests cannot collect real sessions or stop real agents. */
export function createLocalMiddleware(services: Services) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!localRequest(req)) return json(res, 403, { error: 'Not allowed.' })
    let url: URL
    try { url = new URL(req.url ?? '/', 'http://localhost') }
    catch { return json(res, 400, { error: 'Invalid request.' }) }
    if (!['/api/agents', '/api/stop', '/api/quit'].includes(url.pathname)) return next()
    const write = url.pathname !== '/api/agents'
    if (!allowedApiRequest(req, write) || req.method !== (write ? 'POST' : 'GET')) {
      return json(res, 403, { ok: false, error: 'Not allowed.', message: 'Not allowed.' })
    }
    if (url.pathname === '/api/quit') {
      json(res, 200, { ok: true })
      services.quit()
      return
    }
    if (url.pathname === '/api/agents') {
      try { return json(res, 200, services.snapshot(url)) }
      catch { return json(res, 500, { error: 'Unable to read local sessions.' }) }
    }
    let body: unknown
    try { body = JSON.parse(await readBody(req)) }
    catch { return json(res, 400, { ok: false, message: 'Invalid request body.' }) }
    const id = body && typeof body === 'object' && 'id' in body ? body.id : undefined
    if (typeof id !== 'string' || id.length > 512 || !id) return json(res, 400, { ok: false, message: 'Missing or invalid agent id.' })
    try {
      const result = await services.stop(id)
      return json(res, result.ok ? 200 : 409, result)
    } catch { return json(res, 500, { ok: false, message: 'Unable to stop this agent.' }) }
  }
}
