/** Channel color palette optimized for dark backgrounds. */
export const CHANNEL_COLORS = {
  meta: '#f97316',
  google: '#3b82f6',
  tiktok: '#ec4899',
  linkedin: '#8b5cf6',
  dv360: '#06b6d4',
  youtube: '#ef4444',
}

export const CHANNEL_LABELS = {
  meta: 'Meta Ads',
  google: 'Google Ads',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  dv360: 'DV360+Prog.',
  youtube: 'YouTube',
}

/** Chart.js dark theme constants */
export const CHART_THEME = {
  text: '#94a3b8',
  grid: '#1e293b',
  tooltipBg: '#1e293b',
  tooltipText: '#f1f5f9',
  tooltipBorder: '#334155',
}

/** Segment colors */
export const SEGMENT_COLORS = {
  S1: '#f97316',
  S2: '#a855f7',
  S3: '#22c55e',
  S4: '#3b82f6',
}

/** Stable fallback palette for channels not in CHANNEL_COLORS (e.g. raw GA4 labels). */
const FALLBACK_PALETTE = [
  '#3b82f6', '#f97316', '#ec4899', '#8b5cf6', '#06b6d4',
  '#ef4444', '#22c55e', '#eab308', '#14b8a6', '#a855f7',
  '#f472b6', '#64748b', '#fb923c', '#84cc16', '#6366f1',
]

/** Keyword → hub channel mapping for BQ "source / medium" labels. */
const _LABEL_KEYWORDS = [
  ['meta', ['facebook', 'instagram', 'meta', ' fb ', ' ig ', 'fb/', 'ig/']],
  ['google', ['google']],
  ['tiktok', ['tiktok', 'tik tok']],
  ['linkedin', ['linkedin']],
  ['dv360', ['dv360', 'dbm', 'programatik', 'programmatic']],
  ['youtube', ['youtube']],
]

/**
 * Resolve a stable color for a channel label.
 * Matches named hub channels first, then BQ "source / medium" keywords,
 * and finally falls back to a deterministic palette slot by index.
 */
export function getChannelColor(label, index = 0) {
  if (!label) return FALLBACK_PALETTE[index % FALLBACK_PALETTE.length]
  if (CHANNEL_COLORS[label]) return CHANNEL_COLORS[label]
  const lower = ` ${String(label).toLowerCase()} `
  for (const [channel, keywords] of _LABEL_KEYWORDS) {
    if (keywords.some(kw => lower.includes(kw))) return CHANNEL_COLORS[channel]
  }
  return FALLBACK_PALETTE[index % FALLBACK_PALETTE.length]
}
