import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createModelLookup, enrichModels } from '../server/model-catalogue.ts'

const lookup = createModelLookup({
  openai: { name: 'OpenAI', models: { 'gpt-example': { limit: { context: 1000, output: 100 }, tool_call: true } } },
  opencode: { name: 'OpenCode', models: { 'vendor-model-free': { limit: { context: 2000 } } } },
  another: { name: 'Another', models: { 'gpt-example': { limit: { context: 9999 } } } },
})

test('catalogue lookup uses exact provider IDs and exposes model specifications', () => {
  const model = lookup({ provider: 'openai', model: 'gpt-example' })
  assert.equal(model.context, 1000)
  assert.equal(model.output, 100)
  assert.equal(model.toolCall, true)
  assert.equal(lookup({ provider: 'other', harness: 'opencode', model: 'vendor-model-free' }).context, 2000)
  assert.equal(lookup({ provider: 'openai', model: 'unused', details: { modelId: 'another/gpt-example' } }).context, 9999)
})

test('catalogue misses and offline startup retain original agents and IDs', () => {
  assert.equal(lookup({ provider: 'openai', model: 'GPT Example' }), undefined)
  assert.equal(lookup({ provider: 'other', model: 'gpt-example' }), undefined)
  const source = { provider: 'openai', model: 'codex-auto-review' }
  assert.equal(enrichModels([source])[0], source)
  assert.throws(() => createModelLookup({}))
})

test('malformed optional catalogue fields cannot break model detail rendering', () => {
  const lookup = createModelLookup({ openai: { models: { broken: { limit: { context: 'bad', output: -1 }, modalities: { input: 'text' }, reasoning: 'yes' } } } })
  const model = lookup({ provider: 'openai', model: 'broken' })
  assert.equal(model.context, undefined)
  assert.equal(model.output, undefined)
  assert.equal(model.inputModalities, undefined)
  assert.equal(model.reasoning, undefined)
})

test('a stale on-disk catalogue remains usable when the remote fetch fails', () => {
  // Keep the generated fixture under the ignored local artifacts folder.
  const work = path.resolve('.local/catalogue-offline-test')
  fs.mkdirSync(path.join(work, '.local'), { recursive: true })
  fs.writeFileSync(path.join(work, '.local/models-dev.json'), JSON.stringify({
    updatedAt: 1,
    data: { openai: { name: 'OpenAI', models: { 'gpt-fixture': { limit: { context: 1234 } } } } },
  }))
  const moduleUrl = pathToFileURL(path.resolve('server/model-catalogue.ts')).href
  const script = `
    globalThis.fetch = async () => { throw new Error('offline fixture') }
    const { refreshCatalogue, enrichModels } = await import(${JSON.stringify(moduleUrl)})
    await refreshCatalogue()
    const [agent] = enrichModels([{ provider: 'openai', model: 'gpt-fixture' }])
    process.stdout.write(JSON.stringify({ id: agent.model, context: agent.details.catalogue.context }))
  `
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: work, windowsHide: true, encoding: 'utf8' })
  assert.deepEqual(JSON.parse(result), { id: 'gpt-fixture', context: 1234 })
})
