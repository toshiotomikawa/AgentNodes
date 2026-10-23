import type { ReactNode, SVGProps } from 'react'
import {
  siClaude,
  siFigma,
  siGithub,
  siGooglegemini,
  siHubspot,
  siLinear,
  siNotion,
  siOpenai,
  siSlack,
  siStripe,
} from 'simple-icons'
import type { Harness, Provider } from './types'

type Brand = { path: string; hex: string }

function BrandIcon({ icon, size, mono }: { icon: Brand; size: number; mono?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d={icon.path} fill={mono ? 'currentColor' : `var(--brand-${icon.hex}, #${icon.hex})`} />
    </svg>
  )
}

function GeminiStar({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <linearGradient id="gem-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f8df5" />
          <stop offset="1" stopColor="#2459e0" />
        </linearGradient>
      </defs>
      <path d={siGooglegemini.path} fill="url(#gem-g)" />
    </svg>
  )
}

export function ProviderIcon({ provider, size = 14 }: { provider: Provider; size?: number }) {
  switch (provider) {
    case 'anthropic':
      return <BrandIcon icon={siClaude} size={size} />
    case 'openai':
      return <BrandIcon icon={siOpenai} size={size} mono />
    case 'google':
      return <GeminiStar size={size} />
    default:
      return <Stroke size={size} d="M12 8V4H8M4 12a8 8 0 0 0 16 0M9 13h.01M15 13h.01M8 8h8a4 4 0 0 1 4 4v0H4v0a4 4 0 0 1 4-4" />
  }
}

export const HARNESS_LABEL: Record<Harness, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  pi: 'Pi',
  antigravity: 'Antigravity',
  demo: 'Demo',
}

export function HarnessIcon({ harness, size = 12 }: { harness: Harness; size?: number }) {
  if (harness === 'claude-code') return <BrandIcon icon={siClaude} size={size} />
  if (harness === 'codex') return <BrandIcon icon={siOpenai} size={size} mono />
  if (harness === 'opencode')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor" />
        <rect x="7" y="7" width="10" height="10" rx="1.5" fill="none" stroke="var(--card)" strokeWidth="2.6" />
      </svg>
    )
  if (harness === 'pi')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <path d="M4 7h16M9 7v12M15 7v9a3 3 0 0 0 3 3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    )
  // Antigravity's mark is an arch that lifts off the ground.
  if (harness === 'antigravity')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <path d="M3 20c2.5-1 4-6 5.5-10.5S11 4 12 4s2 1 3.5 5.5S18.5 19 21 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    )

  return <Sparkle size={size} />
}

function Stroke({ d, size, ...rest }: { d: string; size: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      <path d={d} />
    </svg>
  )
}

/** Tool icons. Brand tools for the demo, generic glyphs for live agents. */
const TOOL_ICONS: Record<string, (size: number) => ReactNode> = {
  slack: (s) => <BrandIcon icon={siSlack} size={s} />,
  notion: (s) => <BrandIcon icon={siNotion} size={s} mono />,
  github: (s) => <BrandIcon icon={siGithub} size={s} mono />,
  figma: (s) => <BrandIcon icon={siFigma} size={s} />,
  stripe: (s) => <BrandIcon icon={siStripe} size={s} />,
  hubspot: (s) => <BrandIcon icon={siHubspot} size={s} />,
  linear: (s) => <BrandIcon icon={siLinear} size={s} />,
  terminal: (s) => <Stroke size={s} d="M4 17l6-6-6-6M12 19h8" />,
  search: (s) => <Stroke size={s} d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3" />,
  edit: (s) => <Stroke size={s} d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />,
  web: (s) => <Stroke size={s} d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />,
  agent: (s) => <Stroke size={s} d="M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM9 13v2M15 13v2" />,
  plug: (s) => <Stroke size={s} d="M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z" />,
  todo: (s) => <Stroke size={s} d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
  tool: (s) => <Stroke size={s} d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z" />,
}

export function ToolIcon({ tool, size = 12 }: { tool: string; size?: number }) {
  const render = TOOL_ICONS[tool] ?? TOOL_ICONS.tool
  return <span className="tool-icon">{render(size)}</span>
}

/** The demo's harness mark. */
function Sparkle({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M10 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7z" fill="var(--blue)" />
      <path d="M18.5 14c.3 2 1.2 2.9 3.2 3.2-2 .3-2.9 1.2-3.2 3.2-.3-2-1.2-2.9-3.2-3.2 2-.3 2.9-1.2 3.2-3.2z" fill="var(--blue)" opacity=".6" />
    </svg>
  )
}

export const GithubIcon =({ size = 14 }: { size?: number }) => <BrandIcon icon={siGithub} size={size} mono />
export const Funnel = ({ size = 13 }: { size?: number }) => <Stroke size={size} d="M3 5h18l-7 8.5V19l-4 2v-7.5z" />

export const Spinner = ({ size = 11 }: { size?: number }) => (
  <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
    <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
)
export const Check = ({ size = 11 }: { size?: number }) => <Stroke size={size} strokeWidth={2.6} d="M20 6 9 17l-5-5" />
export const Triangle = ({ size = 11 }: { size?: number }) => (
  <Stroke size={size} d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
)
export const Square = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <rect x="5" y="5" width="14" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="2.4" />
  </svg>
)
export const CopyIcon = ({ size = 13 }: { size?: number }) => (
  <Stroke size={size} d="M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
)
export const Cross = ({ size = 12 }: { size?: number }) => <Stroke size={size} d="M18 6 6 18M6 6l12 12" />
export const Clock = ({ size = 11 }: { size?: number }) => <Stroke size={size} d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2" />
export const Chevron = ({ size = 12, up, left, right }: { size?: number; up?: boolean; left?: boolean; right?: boolean }) => (
  <Stroke size={size} d="m6 9 6 6 6-6" style={{ transform: up ? 'rotate(180deg)' : left ? 'rotate(90deg)' : right ? 'rotate(-90deg)' : undefined, transition: 'transform .2s' }} />
)
