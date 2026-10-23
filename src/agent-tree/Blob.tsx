import type { CSSProperties, Ref } from 'react'

/** Colors by model family. Anything unknown gets a stable color from its name. */
const FAMILIES: [RegExp, string][] = [
  [/opus/i, '#d97757'],
  [/sonnet/i, '#8c7be0'],
  [/haiku/i, '#e3a93f'],
  [/fable/i, '#4aa3d4'],
  [/gpt|codex/i, '#2fa37a'],
  [/gemini/i, '#4f8df5'],
  [/minimax/i, '#e2588c'],
]
const SPARE = ['#c46bd6', '#3fb5b0', '#d9814a', '#7a9a3a', '#5d79d8']

const hash = (s: string) => {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return h
}

export function blobColor(model: string) {
  const hit = FAMILIES.find(([re]) => re.test(model))
  return hit ? hit[1] : SPARE[hash(model) % SPARE.length]
}

/**
 * A small creature in the model's color. Its shape (jelly, gumdrop or amoeba) comes from
 * `data-blob` on the root element, so the menu setting restyles every blob at once.
 * It stays still until `bounce` plays its animation once. `ref` reaches the outer element, where
 * `bounce` and `lookAt` act. An `asleep` blob (a closed session) shuts its eyes, breathes slowly
 * and lets a "z" drift up.
 */
export function Blob({ model, color, asleep, ref }: { model: string; color?: string; asleep?: boolean; ref?: Ref<HTMLSpanElement> }) {
  const style = { '--blob': color ?? blobColor(model) } as CSSProperties
  return (
    <span className={asleep ? 'blob asleep' : 'blob'} style={style} ref={ref} aria-hidden onAnimationEnd={(e) => e.target === e.currentTarget.firstChild && e.currentTarget.classList.remove('bounce')}>
      <span className="blob-body">
        <span className="blob-eyes">
          <span className="blob-eye" />
          <span className="blob-eye" />
        </span>
        <span className="blob-shine" />
        <span className="blob-cheek" />
        <span className="blob-cheek" />
      </span>
      {asleep && <span className="blob-z">z</span>}
    </span>
  )
}

/** Plays the blob's animation once, restarting it if it is already playing. */
export function bounce(el: HTMLElement | null) {
  if (!el) return
  el.classList.remove('bounce')
  void el.offsetWidth
  el.classList.add('bounce')
}

/** Turns the eyes toward a point on screen, or back to the middle when no point is given. */
export function lookAt(el: HTMLElement | null, x?: number, y?: number) {
  if (!el) return
  if (x === undefined || y === undefined) {
    el.style.removeProperty('--gx')
    el.style.removeProperty('--gy')
    return
  }
  const b = el.getBoundingClientRect()
  const dx = x - (b.left + b.width / 2)
  const dy = y - (b.top + b.height / 2)
  const d = Math.hypot(dx, dy) || 1
  const k = Math.min(1, d / 40)
  el.style.setProperty('--gx', `${((dx / d) * 2 * k).toFixed(2)}px`)
  el.style.setProperty('--gy', `${((dy / d) * 1.6 * k).toFixed(2)}px`)
}
