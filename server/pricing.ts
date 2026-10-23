/**
 * API list prices in dollars per million tokens. Used only to estimate what a run would cost on
 * the API; subscription plans are billed differently.
 */
export interface Price {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

const p = (input: number, output: number, cacheWrite: number, cacheRead: number): Price => ({ input, output, cacheWrite, cacheRead })

/** First match wins, so specific ids go before families. */
const TABLE: [RegExp, Price][] = [
  [/opus-5/, p(4, 20, 5, 0.2)],
  [/sonnet-5/, p(2, 10, 2.5, 0.1)],
  [/haiku-5/, p(0.1, 0.5, 0.125, 0.01)],
  [/fable-5/, p(10, 50, 12.5, 0.25)],
  [/opus-4/, p(5, 25, 6.25, 0.5)],
  [/sonnet-4/, p(3, 15, 3.75, 0.3)],
  [/haiku-4/, p(1, 5, 1.25, 0.1)],
  [/gpt-6.*astra/, p(10, 50, 10, 0.5)],
  [/gpt-6.*(luna|mini)/, p(0.1, 0.5, 0.1, 0.005)],
  [/gpt-6/, p(2, 10, 2, 0.1)],
  [/codex-auto-review/, p(2, 10, 2, 0.1)],
  // Google's prices as listed on Models.dev; cache writes are not listed, so they count as input.
  [/gemini-3\.[678]-flash/, p(0.75, 3.75, 0.75, 0.075)],
  [/gemini-3\.5-flash-lite/, p(0.3, 2.5, 0.3, 0.03)],
  [/gemini-3\.5-flash/, p(1.5, 9, 1.5, 0.15)],
  [/gemini-3\.1-pro/, p(2, 12, 2, 0.2)],
  // Open weights with no maker price: the rate most hosts on Models.dev charge.
  [/gpt-oss-120b/, p(0.15, 0.6, 0.15, 0.015)],
]

/** Haiku 5.5 charges more once a single prompt passes 100k tokens. */
const HAIKU_LONG = p(0.5, 2.5, 0.625, 0.05)

export function knownPrice(model: string): Price | null {
  const id = model.toLowerCase()
  for (const [re, price] of TABLE) if (re.test(id)) return price
  return null
}

export function isFree(model: string) {
  return /(^|[-_/])free($|[-_/])/i.test(model)
}

export interface Usage {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

/** Cost of one request. Unknown models fall back to the GPT-6 Sol price so they still show something. */
export function costOf(model: string, u: Usage): number {
  if (isFree(model)) return 0
  let price = knownPrice(model) ?? TABLE.find(([re]) => re.source === 'gpt-6')![1]
  if (/haiku-5/.test(model) && u.input + u.cacheWrite + u.cacheRead > 100_000) price = HAIKU_LONG
  return (u.input * price.input + u.output * price.output + u.cacheWrite * price.cacheWrite + u.cacheRead * price.cacheRead) / 1e6
}

/** Display the source API id verbatim, including provider, version and variant. */
export function prettyModel(id: string | undefined | null): string {
  return id || 'unknown-model'
}

export function providerOf(id: string | undefined | null): 'anthropic' | 'openai' | 'google' | 'other' {
  const s = (id ?? '').toLowerCase()
  if (/claude|opus|sonnet|haiku|fable/.test(s)) return 'anthropic'
  if (/gpt|codex|^o\d/.test(s)) return 'openai'
  if (/gemini/.test(s)) return 'google'
  return 'other'
}
