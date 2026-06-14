/** Returns Tailwind text color class for an SL value relative to a target. */
export function slColor(sl: number | null, target: number | null | undefined): string {
  if (sl === null || sl === undefined) return 'text-slate-400'
  const t = target ?? 80
  if (sl >= t) return 'text-green-600'
  if (sl >= t * 0.85) return 'text-yellow-600'
  return 'text-red-600'
}

/** Returns a bar-fill color (hex) relative to target. */
export function slBarColor(sl: number | null, target: number | null | undefined): string {
  if (sl === null || sl === undefined) return '#e2e8f0'
  const t = target ?? 80
  if (sl >= t) return '#22c55e'
  if (sl >= t * 0.85) return '#f59e0b'
  return '#ef4444'
}
