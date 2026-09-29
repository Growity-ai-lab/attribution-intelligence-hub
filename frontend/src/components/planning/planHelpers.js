/** Media-plan helpers: channel/scenario constants, Excel media-plan parsing, spend distribution. */
import * as XLSX from 'xlsx'

export const ONLINE = ['meta', 'google', 'tiktok', 'linkedin', 'dv360', 'youtube', 'x', 'mackolik', 'news', 'tvekstra']
// Planning-only placements: their CPM/CTR/audience defaults are placeholders, so
// plans for them should carry the agency's own CPM (Excel column or settings).
export const PLACEHOLDER_CHANNELS = new Set(['x', 'mackolik', 'news', 'tvekstra'])
export const WEEK_OPTIONS = [4, 8, 12, 16, 20, 24]

export const SCENARIO_PRESETS = {
  minimum: { label: 'Minimum', icon: '↓', spend_mult: 0.5 },
  optimum: { label: 'Optimum', icon: '◎', spend_mult: 1.0 },
  maksimum: { label: 'Maksimum', icon: '↑', spend_mult: 1.5 },
}

// Channel auto-mapping keywords (lowercase matching against Mecra + Site/Network)
const CHANNEL_MAP_KEYWORDS = {
  youtube: ['youtube', 'yt'],
  google: ['google ads', 'google search', 'sem', 'search ads'],
  meta: ['meta', 'facebook', 'instagram', 'fb ', 'ig '],
  tiktok: ['tiktok', 'tik tok'],
  linkedin: ['linkedin'],
  dv360: ['dv360', 'dv 360', 'programatik', 'programmatic', 'preroll', 'display&video'],
  // Checked after the core channels; keep keywords specific ("masthead" alone
  // would also match YouTube masthead lines).
  x: ['twitter', 'x (twitter)', 'x.com'],
  mackolik: ['maçkolik', 'mackolik'],
  news: ['haber site', 'haber sitesi', 'news site'],
  tvekstra: ['tv ekstra', 'tvekstra'],
}

// Header column detection keywords (Turkish media plan conventions)
const SPEND_COL_KEYWORDS = ['net yayin bedeli', 'net yayın bedeli', 'butce', 'bütçe', 'her sey dahil', 'her şey dahil', 'toplam maliyet', 'total cost', 'spend', 'harcama', 'net yayın bedeli']
const MECRA_COL_KEYWORDS = ['mecra', 'media', 'kanal', 'channel']
const SITE_COL_KEYWORDS = ['site', 'network', 'site/network', 'platform']
const IMP_COL_KEYWORDS = ['planlanan', 'impression', 'imp', 'goruntulenme', 'görüntülenme']
const CPM_COL_KEYWORDS = ['cpm', 'birim maliyet', 'birim fiyat', 'unit cost']
const DURATION_COL_KEYWORDS = ['sure', 'süre', 'duration', 'gun', 'gün']

function findColIndex(headers, keywords) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').toLowerCase().replace(/\s+/g, ' ').trim()
    if (keywords.some(kw => h.includes(kw))) return i
  }
  return -1
}

function autoMapChannel(mecra, site) {
  const combined = `${mecra} ${site}`.toLowerCase()
  for (const [ch, keywords] of Object.entries(CHANNEL_MAP_KEYWORDS)) {
    if (keywords.some(kw => combined.includes(kw))) return ch
  }
  return null
}

export function parseMediaPlanExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

        // Find header row (look for "Mecra" or "Platform")
        let headerIdx = -1
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
          const row = rows[i].map(c => String(c).toLowerCase())
          if (row.some(c => MECRA_COL_KEYWORDS.some(kw => c.includes(kw)))) {
            headerIdx = i
            break
          }
        }
        if (headerIdx === -1) {
          reject(new Error('Başlık satırı bulunamadı. "Mecra" veya "Platform" sütunu gerekli.'))
          return
        }

        const headers = rows[headerIdx].map(c => String(c))
        const mecraIdx = findColIndex(headers, MECRA_COL_KEYWORDS)
        const siteIdx = findColIndex(headers, SITE_COL_KEYWORDS)
        const spendIdx = findColIndex(headers, SPEND_COL_KEYWORDS)
        const impIdx = findColIndex(headers, IMP_COL_KEYWORDS)
        const cpmIdx = findColIndex(headers, CPM_COL_KEYWORDS)
        const durationIdx = findColIndex(headers, DURATION_COL_KEYWORDS)

        if (spendIdx === -1) {
          reject(new Error('Bütçe/spend sütunu bulunamadı. "Net Yayın Bedeli" veya "Bütçe" sütunu gerekli.'))
          return
        }

        // Parse data rows
        const lineItems = []
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i]
          const mecra = String(row[mecraIdx] || '').trim()
          const site = siteIdx >= 0 ? String(row[siteIdx] || '').trim() : ''
          const spendRaw = row[spendIdx]
          const spend = typeof spendRaw === 'number' ? spendRaw : parseFloat(String(spendRaw).replace(/[^\d.,\-]/g, '').replace(',', '.')) || 0

          if (!mecra && !site) continue
          if (spend <= 0) continue

          const imp = impIdx >= 0 ? (typeof row[impIdx] === 'number' ? row[impIdx] : parseFloat(String(row[impIdx]).replace(/[^\d]/g, '')) || 0) : 0
          const cpm = cpmIdx >= 0 ? (typeof row[cpmIdx] === 'number' ? row[cpmIdx] : parseFloat(String(row[cpmIdx]).replace(/[^\d.,]/g, '').replace(',', '.')) || 0) : 0
          const duration = durationIdx >= 0 ? String(row[durationIdx] || '') : ''

          const mapped = autoMapChannel(mecra, site)
          lineItems.push({ mecra, site, spend, impressions: imp, cpm, duration, mappedChannel: mapped, rowIndex: i })
        }

        // Extract campaign info from header area
        let campaignName = ''
        let brand = ''
        for (let i = 0; i < headerIdx; i++) {
          const row = rows[i].map(c => String(c).toLowerCase())
          const vals = rows[i].map(c => String(c).trim())
          for (let j = 0; j < row.length; j++) {
            if (row[j].includes('marka')) brand = vals[j + 1] || vals[j + 2] || ''
            if (row[j].includes('kampanya') && row[j].includes('ad')) campaignName = vals[j + 1] || vals[j + 2] || ''
          }
        }

        // Aggregate by mapped channel
        const channelAgg = {}
        for (const item of lineItems) {
          const ch = item.mappedChannel || '_unmapped'
          if (!channelAgg[ch]) channelAgg[ch] = { totalSpend: 0, totalImp: 0, items: [], labels: [] }
          channelAgg[ch].totalSpend += item.spend
          channelAgg[ch].totalImp += item.impressions
          channelAgg[ch].items.push(item)
          const label = `${item.mecra}${item.site ? ' / ' + item.site : ''}`
          if (!channelAgg[ch].labels.includes(label)) channelAgg[ch].labels.push(label)
        }

        resolve({ lineItems, channelAgg, campaignName, brand, headers: headers.map(String) })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Dosya okunamadi'))
    reader.readAsArrayBuffer(file)
  })
}

export function distributeSpend(totalSpend, numWeeks, mode = 'front-loaded') {
  let weeks
  if (mode === 'even') {
    weeks = Array(numWeeks).fill(Math.round(totalSpend / numWeeks / 1000) * 1000)
  } else {
    // Front-loaded: first week gets ~1.4x avg, linearly decreasing
    const weights = Array.from({ length: numWeeks }, (_, i) => numWeeks - i * 0.6)
    const totalW = weights.reduce((a, b) => a + b, 0)
    weeks = weights.map(w => Math.round((w / totalW) * totalSpend / 1000) * 1000)
  }
  // Rounding to 1,000 TL can drift the total; keep the plan's budget exact.
  const drift = totalSpend - weeks.reduce((a, b) => a + b, 0)
  if (weeks.length) weeks[weeks.length - 1] += drift
  return weeks
}

/**
 * The agency's own CPM for a set of imported plan lines, when the Excel carries it:
 * planned impressions on every line (spend / impressions), else a CPM on every
 * line (spend-weighted). Returns null when the file has neither — the simulator
 * then uses the channel default.
 */
export function agencyCpm(items) {
  if (!items?.length) return null
  const spend = items.reduce((s, it) => s + it.spend, 0)
  if (items.every(it => it.impressions > 0)) {
    const imps = items.reduce((s, it) => s + it.impressions, 0)
    return Math.round((spend / imps) * 1000 * 100) / 100
  }
  if (items.every(it => it.cpm > 0)) {
    return Math.round((items.reduce((s, it) => s + it.cpm * it.spend, 0) / spend) * 100) / 100
  }
  return null
}
