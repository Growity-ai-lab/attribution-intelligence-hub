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
