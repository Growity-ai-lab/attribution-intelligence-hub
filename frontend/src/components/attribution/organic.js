/** Organic / direct traffic detection for "source / medium" channel labels. */
const ORGANIC_MEDIUMS = ['organic', 'referral', '(none)', 'social', 'email', 'aylikmail']
const ORGANIC_SOURCES = ['(direct)', 'direct']
export const isOrganic = ch => {
  const parts = ch.toLowerCase().split(' / ')
  const source = (parts[0] || '').trim()
  const medium = (parts[1] || '').trim()
  if (ORGANIC_SOURCES.includes(source)) return true
  return ORGANIC_MEDIUMS.some(kw => medium.includes(kw))
}
