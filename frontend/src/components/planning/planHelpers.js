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
const DATES_COL_KEYWORDS = ['yayın tarih', 'yayin tarih', 'flight', 'tarih']
const AUDIENCE_COL_KEYWORDS = ['kitle büyüklüğü', 'kitle buyuklugu', 'hedef kitle', 'audience size', 'evren', 'universe']

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
        const datesIdx = col(DATES_COL_KEYWORDS)
        const audienceIdx = col(AUDIENCE_COL_KEYWORDS)
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
          const datesCell = datesIdx >= 0 ? row[datesIdx] : ''
          const audience = audienceIdx >= 0 && typeof row[audienceIdx] === 'number' ? Math.round(row[audienceIdx]) : null
          const mapped = autoMapChannel(lineText, mecra)
          // "Google / Search / Search" → "Google / Search"
          const label = [mecra, site, format].filter((v, k, all) => v && all.findIndex(o => lower(o) === lower(v)) === k).join(' / ')
          lineItems.push(withBasis({
            mecra, site, format, label, spend, qty, unit, cpmGiven: qty ? 0 : unit, model, duration,
            // Flight as written in the plan; resolved to weeks once the plan start is known.
            datesText: typeof datesCell === 'number' ? '' : String(datesCell ?? '').trim(),
            dateSerial: typeof datesCell === 'number' ? datesCell : null,
            durationDays: parseDurationDays(duration),
            audience,
            objective: autoObjective(basis, lineText),
            mappedChannel: mapped, rowIndex: i,
          }, basis || 'none'))
        }

        // Extract campaign info from header area
        let campaignName = ''
        let brand = ''
        let period = ''
        for (let i = 0; i < headerIdx; i++) {
          const row = rows[i].map(c => lower(c))
          const vals = rows[i].map(c => String(c).trim())
          for (let j = 0; j < row.length; j++) {
            if (row[j].includes('marka')) brand = vals[j + 1] || vals[j + 2] || ''
            if (row[j].includes('kampanya') && row[j].includes('ad')) campaignName = vals[j + 1] || vals[j + 2] || ''
            if (row[j].includes('dönem') || row[j].includes('donem')) period = vals[j + 1] || vals[j + 2] || ''
          }
        }
        const planStart = defaultPlanStart({ period, campaignName, lineItems })

        resolve({ lineItems, skippedTotals, campaignName, brand, period, planStart, sheetName, headers: headers.map(String) })
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

// --------------- Line objective, audience and flight ---------------

/** What a plan line is bought for; only traffic and lead lines are expected to bring clicks. */
export const OBJECTIVE_OPTIONS = [
  { value: 'reach', label: 'Erişim' },
  { value: 'traffic', label: 'Trafik' },
  { value: 'video', label: 'Video izlenme' },
  { value: 'lead', label: 'Lead' },
]
const LEAD_LINE_RE = /\blead|form|başvuru|basvuru|dönüşüm|donusum|conversion|\bcpl\b|\bcpa\b/i

export function autoObjective(basis, text = '') {
  if (LEAD_LINE_RE.test(text)) return 'lead'
  if (basis === 'clicks' || CLICK_LINE_RE.test(text)) return 'traffic'
  if (basis === 'views' || VIEW_LINE_RE.test(text) || /pre-?roll/i.test(text)) return 'video'
  return 'reach'
}

const MONTHS = {
  ocak: 0, şubat: 1, subat: 1, mart: 2, nisan: 3, mayıs: 4, mayis: 4, haziran: 5, temmuz: 6,
  ağustos: 7, agustos: 7, eylül: 8, eylul: 8, ekim: 9, kasım: 10, kasim: 10, aralık: 11, aralik: 11,
}
const monthOf = word => MONTHS[lower(word)]
const DAY_MS = 86_400_000
const utc = (y, m, d) => Date.UTC(y, m, d)
export const isoDate = ms => new Date(ms).toISOString().slice(0, 10)
const excelSerialToMs = serial => Date.UTC(1899, 11, 30) + Math.round(serial) * DAY_MS

/** Days of a "Süre" cell: 5, "1 gün", "5 gün (12 - 16 Ekim)" → 5; null when absent. */
export function parseDurationDays(v) {
  const m = String(v ?? '').match(/^\s*(\d{1,3})(\s*(gün|gun|day))?/i)
  return m ? Number(m[1]) : null
}

/**
 * Flight dates written in a plan cell, as UTC ms {start, end} (inclusive), or null.
 * "12 - 16 Ekim", "12 Ekim - 3 Kasım", "5 gün (12 - 16 Ekim)", "12.10.2026 - 16.10.2026", "12 Ekim".
 */
export function parseFlightDates(text, year) {
  const t = String(text ?? '')
  let m = t.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\s*[-–]\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/)
  if (m) {
    const y1 = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : year
    const y2 = m[6] ? Number(m[6].length === 2 ? `20${m[6]}` : m[6]) : y1
    return { start: utc(y1, Number(m[2]) - 1, Number(m[1])), end: utc(y2, Number(m[5]) - 1, Number(m[4])) }
  }
  m = t.match(/(\d{1,2})\s*([a-zçğıöşüİ]+)\s*[-–]\s*(\d{1,2})\s*([a-zçğıöşüİ]+)/i)
  if (m && monthOf(m[2]) !== undefined && monthOf(m[4]) !== undefined) {
    const m1 = monthOf(m[2]); const m2 = monthOf(m[4])
    return { start: utc(year, m1, Number(m[1])), end: utc(m2 < m1 ? year + 1 : year, m2, Number(m[3])) }
  }
  m = t.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*([a-zçğıöşüİ]+)/i)
  if (m && monthOf(m[3]) !== undefined) {
    return { start: utc(year, monthOf(m[3]), Number(m[1])), end: utc(year, monthOf(m[3]), Number(m[2])) }
  }
  for (const d of t.matchAll(/(\d{1,2})\s*([a-zçğıöşüİ]+)/gi)) {
    if (monthOf(d[2]) === undefined) continue // "5 gün"
    const day = utc(year, monthOf(d[2]), Number(d[1]))
    return { start: day, end: day }
  }
  return null
}

/** Year the plan runs in: a 4-digit year in the campaign name or period, else the next time that month comes. */
function planYear({ period = '', campaignName = '' }, month = null) {
  const y = `${period} ${campaignName}`.match(/\b(20\d{2})\b/)
  if (y) return Number(y[1])
  const now = new Date()
  return month != null && month < now.getUTCMonth() ? now.getUTCFullYear() + 1 : now.getUTCFullYear()
}

/**
 * First day of the plan (ISO date): the campaign period's first month ("Ekim", "Ekim-Aralık"),
 * else the earliest dated line, else today.
 */
export function defaultPlanStart({ period = '', campaignName = '', lineItems = [] }) {
  const word = `${period} ${campaignName}`.match(/[a-zçğıöşüİ]+/gi)?.find(w => monthOf(w) !== undefined)
  if (word) {
    const month = monthOf(word)
    return isoDate(utc(planYear({ period, campaignName }, month), month, 1))
  }
  const year = planYear({ period, campaignName })
  const starts = lineItems
    .map(it => (it.dateSerial ? excelSerialToMs(it.dateSerial) : parseFlightDates(`${it.datesText} ${it.duration}`, year)?.start))
    .filter(Boolean)
  return isoDate(starts.length ? Math.min(...starts) : Date.now())
}

/**
 * Where a line runs in the plan, in plan days and weeks (0-based days, 1-based weeks):
 * its written dates if any, else "Süre" days from the plan start (launch), else the whole plan.
 * Returns {startWeek, endWeek, startDay?, endDay?, source: 'dates'|'duration'|'plan'}.
 */
export function autoFlight(item, planStartIso, numWeeks) {
  const start = Date.parse(`${planStartIso}T00:00:00Z`)
  const lastDay = numWeeks * 7 - 1
  const clampDay = d => Math.min(Math.max(d, 0), lastDay)
  const weeksOf = (a, b) => ({ startWeek: Math.floor(a / 7) + 1, endWeek: Math.floor(b / 7) + 1 })
  const year = new Date(start).getUTCFullYear()
  let dates = item.dateSerial ? { start: excelSerialToMs(item.dateSerial), end: excelSerialToMs(item.dateSerial) } : null
  dates ??= parseFlightDates(`${item.datesText || ''} ${item.duration || ''}`, year)
  if (dates && !Number.isNaN(start)) {
    let end = dates.end
    // "12 Ekim" with a 5-day "Süre": run the stated days.
    if (dates.start === dates.end && item.durationDays > 1) end = dates.start + (item.durationDays - 1) * DAY_MS
    const a = clampDay(Math.round((dates.start - start) / DAY_MS))
    const b = clampDay(Math.round((end - start) / DAY_MS))
    return { ...weeksOf(a, Math.max(a, b)), startDay: a, endDay: Math.max(a, b), source: 'dates' }
  }
  if (item.durationDays > 0) {
    const b = clampDay(item.durationDays - 1)
    return { ...weeksOf(0, b), startDay: 0, endDay: b, source: 'duration' }
  }
  return { startWeek: 1, endWeek: numWeeks, source: 'plan' }
}

/**
 * A line's weekly spends over the plan: dated/duration flights spread evenly over their
 * days, a week range (whole plan or picked by the user) by the chosen distribution.
 */
export function lineWeeklySpends(spend, flight, numWeeks, mode = 'front-loaded') {
  const weeks = Array(numWeeks).fill(0)
  if (flight?.startDay != null && flight?.endDay != null) {
    const days = flight.endDay - flight.startDay + 1
    for (let d = flight.startDay; d <= flight.endDay; d++) weeks[Math.min(Math.floor(d / 7), numWeeks - 1)] += spend / days
    const rounded = weeks.map(w => Math.round(w))
    // Keep the line's budget exact after rounding.
    rounded[Math.min(Math.floor(flight.endDay / 7), numWeeks - 1)] += spend - rounded.reduce((a, b) => a + b, 0)
    return rounded
  }
  const s = Math.min(Math.max(flight?.startWeek || 1, 1), numWeeks)
  const e = Math.min(Math.max(flight?.endWeek || numWeeks, s), numWeeks)
  distributeSpend(spend, e - s + 1, mode).forEach((v, i) => { weeks[s - 1 + i] = v })
  return weeks
}

/** Summed weekly spends of plan lines. */
export function linesWeeklySpends(lines, numWeeks, mode) {
  const total = Array(numWeeks).fill(0)
  for (const l of lines) lineWeeklySpends(l.spend, l.flight, numWeeks, mode).forEach((v, i) => { total[i] += v })
  return total
}

/** Impressions planned on traffic/lead CPM lines: the only impressions expected to bring clicks. */
export function trafficImpressions(items) {
  return (items || []).reduce((s, it) => s + (['traffic', 'lead'].includes(it.objective) ? it.impressions || 0 : 0), 0)
}

/** Largest audience set on the lines (line audiences are assumed nested), or null. */
export function linesAudience(items) {
  const a = (items || []).map(it => Number(it.audience) || 0).filter(v => v > 0)
  return a.length ? Math.max(...a) : null
}

