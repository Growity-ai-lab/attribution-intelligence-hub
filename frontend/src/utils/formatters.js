/** Format number as Turkish Lira. */
export function formatCurrency(value) {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

/** Format number with thousand separators. */
export function formatNumber(value) {
  return new Intl.NumberFormat('tr-TR').format(value)
}

/** Format as percentage. */
export function formatPercent(value, decimals = 1) {
  return `%${(value * 100).toFixed(decimals)}`
}

/** Shorten large numbers: 1.2M, 500K etc. */
export function formatCompact(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`
  return value.toString()
}

/** Shorten large numbers with TL suffix: 2.6M TL, 300K TL */
export function formatCompactTL(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M TL`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K TL`
  return `${value} TL`
}

export const fmtMoney = v => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return v.toFixed(0)
}

export const fmtN = v =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0)

export const fmtPct = v => `%${(v * 100).toFixed(1)}`
