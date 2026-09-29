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
  linkedin: ['linkedin', 'linkedln'],
  dv360: ['dv360', 'dv 360', 'programatik', 'programmatic', 'preroll', 'display&video'],
  // Checked after the core channels; keep keywords specific ("masthead" alone
  // would also match YouTube masthead lines).
  x: ['twitter', 'x (twitter)', 'x.com'],
  mackolik: ['maçkolik', 'mackolik'],
  // Before news: TV Ekstra lines list TV channels (e.g. Habertürk) by name.
  tvekstra: ['tv ekstra', 'tvekstra'],
  news: ['haber site', 'haber sitesi', 'news site', 'sozcu', 'sözcü', 'hurriyet', 'hürriyet', 'sabah.com',
    'sondakika', 'mynet', 'milliyet', 'haberturk.com', 'ensonhaber', 'haber7', 'internethaber', 'cnnturk.com'],
}

// Header column detection keywords (Turkish media plan conventions), most specific first:
// a column is matched by the first keyword any header contains.
const SPEND_COL_KEYWORDS = ['net yayın bedeli', 'net yayin bedeli', 'butce', 'bütçe', 'her şey dahil', 'her sey dahil', 'toplam maliyet', 'total cost', 'spend', 'harcama']
const MECRA_COL_KEYWORDS = ['mecra', 'media', 'kanal', 'channel']
// "Platform" last: agency plans also use it for the device (Desktop / Mobile).
const SITE_COL_KEYWORDS = ['site/network', 'site', 'network', 'platform']
// Placement / format ("Yayın Türü": Search, Masthead, Trueview, Traffic, Preroll...).
const FORMAT_COL_KEYWORDS = ['yayın türü', 'yayin turu', 'format', 'ürün', 'urun']
const TARGETING_COL_KEYWORDS = ['hedefleme', 'kategori', 'targeting']
// The planned quantity; "Planlanan (imp, view, Click)" / "Planlanan Gösterim / Tıklama"
// columns mix units per line — see lineBasis().
const QTY_COL_KEYWORDS = ['planlanan gösterim', 'planlanan (imp', 'gösterim', 'gosterim', 'impression', 'imp']
const CPM_COL_KEYWORDS = ['cpm']
// A unit price is a CPM only on lines bought on CPM (the buying-model column says so).
const UNIT_PRICE_COL_KEYWORDS = ['birim maliyet', 'birim fiyat', 'unit cost', 'unit price']
const MODEL_COL_KEYWORDS = ['satın alma', 'satin alma', 'alım modeli', 'alim modeli', 'buying', 'fiyatlama']
// Total / subtotal rows repeat the lines above them; importing them double counts the budget.
const TOTAL_ROW_RE = /^((genel|ara)\s+)?(toplam|total|subtotal)\b|\s(toplam|total|subtotal)$/i
const DURATION_COL_KEYWORDS = ['süre', 'sure', 'duration']

// Plain toLowerCase (a 'tr' locale would turn "Instagram" into "ınstagram"); "İ" → "i".
const lower = v => String(v ?? '').toLowerCase().replace(/i\u0307/g, 'i')
const normHeader = h => lower(h).replace(/\s+/g, ' ').trim()

function findColIndex(headers, keywords) {
  const hs = headers.map(normHeader)
  for (const kw of keywords) {
    const i = hs.findIndex(h => h.includes(kw))
    if (i >= 0) return i
  }
  return -1
}

function autoMapChannel(text, mecra = '') {
  const combined = lower(text)
  for (const [ch, keywords] of Object.entries(CHANNEL_MAP_KEYWORDS)) {
    if (keywords.some(kw => combined.includes(kw))) return ch
  }
  // Names too short to search inside free text.
  const m = lower(mecra).trim()
  if (m === 'x') return 'x'
  return null
}

/** The header row of a sheet: needs a media column and a budget column. */
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const hs = rows[i].map(String)
    if (findColIndex(hs, MECRA_COL_KEYWORDS) >= 0 && findColIndex(hs, SPEND_COL_KEYWORDS) >= 0) return i
  }
  return -1
}

/** Buying models a user can pick per line; the value is what the planned quantity counts. */
export const BASIS_OPTIONS = [
  { value: 'impressions', label: 'CPM – gösterim' },
  { value: 'clicks', label: 'CPC – tıklama' },
  { value: 'views', label: 'CPV – izlenme' },
  { value: 'none', label: 'Diğer – miktar kullanılmaz' },
]

/** A plan line with its quantity read as the given basis (auto-detected or picked by the user). */
export function withBasis(item, basis) {
  const qty = item.qty ?? item.impressions ?? 0
  const b = basis || item.basis
  return {
    ...item,
    basis: b,
    impressions: b === 'impressions' ? qty : 0,
    clicks: b === 'clicks' ? qty : 0,
    views: b === 'views' ? qty : 0,
    // A unit price is a CPM only on impression lines; without a quantity keep a CPM given on the line.
    cpm: b === 'impressions' && qty > 0 ? item.spend / qty * 1000 : (qty > 0 ? 0 : item.cpmGiven || 0),
  }
}

export function parseMediaPlanExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        // Agency workbooks often open with a summary sheet: use the first sheet with a plan table.
        let rows = null
        let headerIdx = -1
        let sheetName = ''
        for (const name of wb.SheetNames) {
          const r = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' })
          const h = findHeaderRow(r)
          if (h >= 0) { rows = r; headerIdx = h; sheetName = name; break }
        }
        if (headerIdx === -1) {
          reject(new Error('Plan tablosu bulunamadı. Başlık satırında "Mecra" ve "Net Yayın Bedeli" (veya "Bütçe") sütunları gerekli.'))
          return
        }

        const headers = rows[headerIdx].map(c => String(c))
        const col = kws => findColIndex(headers, kws)
        const mecraIdx = col(MECRA_COL_KEYWORDS)
        const siteIdx = col(SITE_COL_KEYWORDS)
        const formatIdx = col(FORMAT_COL_KEYWORDS)
        const targetingIdx = col(TARGETING_COL_KEYWORDS)
        const spendIdx = col(SPEND_COL_KEYWORDS)
        const qtyIdx = col(QTY_COL_KEYWORDS)
        const cpmIdx = col(CPM_COL_KEYWORDS)
        const unitPriceIdx = col(UNIT_PRICE_COL_KEYWORDS)
        const modelIdx = col(MODEL_COL_KEYWORDS)
        const durationIdx = col(DURATION_COL_KEYWORDS)
        const text = (row, idx) => (idx >= 0 ? String(row[idx] ?? '').replace(/\s+/g, ' ').trim() : '')

        // Parse data rows
        const lineItems = []
        const skippedTotals = []
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i]
          const mecra = text(row, mecraIdx)
          const site = text(row, siteIdx)
          const format = text(row, formatIdx)
          const targeting = text(row, targetingIdx)
          const spendRaw = row[spendIdx]
          const spend = typeof spendRaw === 'number' ? spendRaw : parseFloat(String(spendRaw).replace(/[^\d.,\-]/g, '').replace(',', '.')) || 0

          if (!mecra && !site) continue
          if (spend <= 0) continue
          if (TOTAL_ROW_RE.test(mecra) || TOTAL_ROW_RE.test(site)) { skippedTotals.push({ label: mecra || site, spend }); continue }

          const model = text(row, modelIdx).toUpperCase()
          const qty = qtyIdx >= 0 ? (typeof row[qtyIdx] === 'number' ? row[qtyIdx] : parseFloat(String(row[qtyIdx]).replace(/[^\d]/g, '')) || 0) : 0
          const num = idx => (typeof row[idx] === 'number' ? row[idx] : parseFloat(String(row[idx]).replace(/[^\d.,]/g, '').replace(',', '.')) || 0)
          let unit = cpmIdx >= 0 ? num(cpmIdx) : 0
          if (!unit && unitPriceIdx >= 0 && model.includes('CPM')) unit = num(unitPriceIdx)
          const lineText = `${mecra} ${site} ${format} ${targeting} ${model}`
          const basis = lineBasis(spend, unit, qty, lineText)
          const duration = text(row, durationIdx)
          const mapped = autoMapChannel(lineText, mecra)
          // "Google / Search / Search" → "Google / Search"
          const label = [mecra, site, format].filter((v, k, all) => v && all.findIndex(o => lower(o) === lower(v)) === k).join(' / ')
          lineItems.push(withBasis({
            mecra, site, format, label, spend, qty, unit, cpmGiven: qty ? 0 : unit, model, duration,
            mappedChannel: mapped, rowIndex: i,
          }, basis || 'none'))
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

        resolve({ lineItems, skippedTotals, campaignName, brand, sheetName, headers: headers.map(String) })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Dosya okunamadi'))
    reader.readAsArrayBuffer(file)
  })
}

const CLICK_LINE_RE = /search|arama|traffic|trafik|tıklama|tiklama|click|cpc/i
const VIEW_LINE_RE = /trueview|video views?|izlenme|görüntülenme|goruntulenme|cpv/i

/**
 * What a plan line's planned quantity counts. Agency plans often share one
 * "unit cost" and one "planned quantity" column across CPM, CPC and CPV lines,
 * so the unit is read from the numbers: spend / qty × 1000 ≈ unit cost → CPM
 * line (impressions); spend / qty ≈ unit cost → cost per unit, which is clicks on
 * search/traffic lines, views on TrueView/video-view lines, else impressions
 * bought per piece (push, addressable TV). Returns null when there is no quantity.
 */
export function lineBasis(spend, unit, qty, text = '') {
  if (!(qty > 0)) return null
  if (unit > 0) {
    const close = (a, b) => Math.abs(a - b) <= 0.05 * b
    if (close(spend / qty * 1000, unit)) return 'impressions'
    if (close(spend / qty, unit)) {
      if (CLICK_LINE_RE.test(text)) return 'clicks'
      // A preroll priced per piece is bought per view (CPV).
      if (VIEW_LINE_RE.test(text) || /pre-?roll/i.test(text)) return 'views'
      return 'impressions'
    }
  }
  // No usable unit cost: trust the line's wording, default to impressions.
  if (CLICK_LINE_RE.test(text)) return 'clicks'
  if (VIEW_LINE_RE.test(text)) return 'views'
  return 'impressions'
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
 * The agency's own CPM for a set of imported plan lines: spend / planned
 * impressions over the lines that plan impressions (click and view lines have
 * none and are left out), else a CPM given on the lines (spend-weighted).
 * Returns null when the file has neither — the simulator then uses the channel default.
 */
export function agencyCpm(items) {
  if (!items?.length) return null
  const impLines = items.filter(it => it.impressions > 0)
  if (impLines.length) {
    const spend = impLines.reduce((s, it) => s + it.spend, 0)
    const imps = impLines.reduce((s, it) => s + it.impressions, 0)
    return Math.round((spend / imps) * 1000 * 100) / 100
  }
  const cpmLines = items.filter(it => it.cpm > 0)
  if (cpmLines.length) {
    const spend = cpmLines.reduce((s, it) => s + it.spend, 0)
    return Math.round((cpmLines.reduce((s, it) => s + it.cpm * it.spend, 0) / spend) * 100) / 100
  }
  return null
}

/** Clicks the plan commits to on its CPC (search/traffic) lines, or null. */
export function agencyClicks(items) {
  const clicks = (items || []).reduce((s, it) => s + (it.clicks || 0), 0)
  return clicks > 0 ? Math.round(clicks) : null
}
