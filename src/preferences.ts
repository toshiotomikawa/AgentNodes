export const read = <T extends string>(key: string, fallback: T): T => {
  try { return (localStorage.getItem(key) as T) || fallback } catch { return fallback }
}

export const save = (key: string, value: string) => {
  try { localStorage.setItem(key, value) } catch {}
}
