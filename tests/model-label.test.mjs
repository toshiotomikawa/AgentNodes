import assert from 'node:assert/strict'
import test from 'node:test'
import { prettyModel } from '../server/pricing.ts'

test('model labels preserve source API ids rather than title-casing or shortening them', () => {
  for (const id of [
    'claude-opus-5-5',
    'claude-sonnet-4-20250514',
    'gpt-6.1-sol',
    'codex-auto-review',
    'gemini-3.8-flash',
    'opencode/minimax-m3.1-flash-free',
    'anthropic/claude-sonnet-4:thinking',
    'provider/MixedCase-Model[variant]',
  ]) assert.equal(prettyModel(id), id)
})

test('missing model ids have a consistent dash-separated fallback', () => {
  for (const id of [null, undefined, '']) assert.equal(prettyModel(id), 'unknown-model')
})
