const DIGITS = '0123456789'

/** Renders text where every digit rolls like an odometer when it changes. */
export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const chars = value.split('')
  return (
    <span className={`rolling ${className ?? ''}`} aria-label={value}>
      {chars.map((ch, i) => {
        // Key from the right so the ones digit keeps its column when the number grows.
        const key = chars.length - i
        if (!DIGITS.includes(ch)) {
          return (
            <span key={key} className="rolling-static" aria-hidden>
              {ch}
            </span>
          )
        }
        return (
          <span key={key} className="rolling-col" aria-hidden>
            <span className="rolling-strip" style={{ transform: `translateY(calc(var(--rh) * ${-Number(ch)}))` }}>
              {DIGITS.split('').map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        )
      })}
    </span>
  )
}
