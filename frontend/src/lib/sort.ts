export type SortDir = 'asc' | 'desc'

export function sortRows<T extends Record<string, unknown>>(
  rows: T[],
  key: keyof T,
  dir: SortDir,
): T[] {
  const mul = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    // nulls always last, both directions
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul
    return String(av).localeCompare(String(bv)) * mul
  })
}
