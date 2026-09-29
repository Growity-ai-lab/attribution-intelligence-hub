// Smoke tests for flows that have broken at runtime while the build stayed
// green: a render crash lands on the app's ErrorBoundary ("Bir hata oluştu"),
// which unit tests and `vite build` cannot see.
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { ADMIN_PASSWORD } from '../playwright.config.js'

const CRASH_TEXT = 'Bir hata oluştu'

// Fail the test on any uncaught page error, and on the ErrorBoundary screen.
test.beforeEach(async ({ page }, testInfo) => {
  testInfo.pageErrors = []
  page.on('pageerror', err => testInfo.pageErrors.push(err.message))
})
test.afterEach(async ({ page }, testInfo) => {
  await expect(page.getByText(CRASH_TEXT)).toHaveCount(0)
  expect(testInfo.pageErrors, 'uncaught page errors').toEqual([])
})

// /api/auth/login is rate limited (5/min per IP), so the suite logs in for
// real once — through the UI form — and reuses that token afterwards.
let adminToken = null

async function apiLogin(request) {
  if (!adminToken) {
    const res = await request.post('/api/auth/login', {
      form: { username: 'admin', password: ADMIN_PASSWORD },
    })
    expect(res.ok()).toBeTruthy()
    adminToken = (await res.json()).access_token
  }
  return { Authorization: `Bearer ${adminToken}` }
}

async function findCampaign(request, headers, clientName, campaignName) {
  const clients = await (await request.get('/api/clients', { headers })).json()
  const client = clients.find(c => c.name === clientName)
  const campaigns = await (await request.get(`/api/clients/${client.id}/campaigns`, { headers })).json()
  return campaigns.find(c => c.name === campaignName).id
}

async function uiLogin(page) {
  if (adminToken) {
    // Reuse the token; the rest of the flow (/auth/me, data loading) stays real.
    await page.route('**/api/auth/login', route => route.fulfill({
      json: { access_token: adminToken, token_type: 'bearer' },
    }))
  }
  await page.goto('/')
  await page.locator('input[type=password]').fill(ADMIN_PASSWORD)
  await page.locator('input:not([type=password])').first().fill('admin')
  const loginResponse = page.waitForResponse('**/api/auth/login')
  await page.locator('input[type=password]').press('Enter')
  const res = await loginResponse
  expect(res.ok()).toBeTruthy()
  adminToken ??= (await res.json()).access_token
  await expect(page.getByText('Petrol Ofisi').first()).toBeVisible()
}

async function openCampaign(page, clientName, campaignName) {
  await page.getByText(clientName).first().click()
  await page.getByText(campaignName, { exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Unified Rapor' })).toBeVisible()
}

test('demo login lands on the Petrol Ofisi campaign and every tab renders', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Demo Modunda Keşfet').click()
  await expect(page.locator('header').first()).toContainText('AutoMatic Filo')

  await page.getByRole('tab', { name: 'Attribution', exact: true }).click()
  for (const name of ['BigQuery (GA4)', 'BigQuery (Tablo)', 'CSV Upload']) {
    await page.getByRole('tab', { name }).click()
    await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
  }
  await page.getByRole('tab', { name: 'Medya Planlama' }).click()
  await page.getByRole('tab', { name: 'Unified Rapor' }).click()
})

test('report page shows the stored result after a CSV run', async ({ page, request }) => {
  const configCalls = []
  page.on('request', req => { if (req.url().includes('/api/config/channels')) configCalls.push(req.url()) })
  await uiLogin(page) // the suite's one real form login
  const headers = await apiLogin(request)
  const campaignId = await findCampaign(request, headers, 'Petrol Ofisi', 'Premium Market')
  const run = await request.post('/api/dda/run-from-csv', {
    headers,
    params: { campaign_id: campaignId },
    multipart: {
      file: {
        name: 'journeys.csv',
        mimeType: 'text/csv',
        buffer: readFileSync('data/sample/journeys_sample.csv'),
      },
    },
  })
  expect(run.ok()).toBeTruthy()

  await openCampaign(page, 'Petrol Ofisi', 'Premium Market')
  await expect(page.getByText('Son kayıtlı analiz gösteriliyor')).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(configCalls, 'channel config is not fetched (it was unused and fetched 3x)').toEqual([])
  await expect(page.getByText('Uyarılar')).toBeVisible()
  await expect(page.getByText('DDA Kanal Attribution')).toBeVisible()

  await page.getByRole('tab', { name: 'Attribution', exact: true }).click()
  await expect(page.getByText('Kanal Katkı Payları')).toBeVisible()
})

test('generic BigQuery table form renders after connecting', async ({ page }) => {
  // No real BigQuery in CI: stub the connect call so the mapping form renders.
  await page.route('**/api/integrations/bigquery/connect**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ event_tables: 3, first_date: '2026-01-01', last_date: '2026-06-30' }),
  }))
  await uiLogin(page)
  await openCampaign(page, 'Petrol Ofisi', 'AutoMatic Filo')
  await page.getByRole('tab', { name: 'Attribution', exact: true }).click()
  await page.getByRole('tab', { name: 'BigQuery (Tablo)' }).click()

  await page.getByPlaceholder('unicef-bagis').fill('demo-project')
  await page.getByPlaceholder('analytics_358380518').fill('demo_dataset')
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'creds.json', mimeType: 'application/json', buffer: Buffer.from('{}'),
  })
  await page.getByRole('button', { name: 'Bağlan', exact: true }).click()

  const run = page.getByRole('button', { name: 'Attribution Analizi Başlat' })
  await expect(run).toBeDisabled() // required mapping fields still empty
  await page.getByPlaceholder('crm_events').fill('crm_events')
  await page.getByPlaceholder('user_id').fill('customer_id')
  await page.getByPlaceholder('event_time').fill('touch_ts')
  await page.getByPlaceholder('channel').fill('channel')
  await page.getByPlaceholder('is_converted (bool/int)').fill('is_converted')
  await expect(run).toBeEnabled()
})

test('budget simulator and CPL planner run end to end', async ({ page, request }) => {
  // Exercises the simulator's click handlers, which only fail at click time.
  const headers = await apiLogin(request)
  const campaignId = await findCampaign(request, headers, 'Petrol Ofisi', 'AutoMatic Filo')
  const run = await request.post('/api/dda/run-from-csv', {
    headers,
    params: { campaign_id: campaignId },
    multipart: {
      file: { name: 'journeys.csv', mimeType: 'text/csv', buffer: readFileSync('data/sample/journeys_sample.csv') },
    },
  })
  expect(run.ok()).toBeTruthy()

  await uiLogin(page)
  await openCampaign(page, 'Petrol Ofisi', 'AutoMatic Filo')
  await page.getByRole('tab', { name: 'Attribution', exact: true }).click()

  const spendInputs = page.locator('input[type=number][placeholder="0"]')
  await expect(spendInputs.first()).toBeVisible()
  await spendInputs.nth(0).fill('100000')
  await spendInputs.nth(1).fill('50000')
  await page.getByRole('button', { name: 'Simüle Et', exact: true }).click()
  await expect(page.getByText('Toplam Harcama').first()).toBeVisible()

  await page.getByRole('button', { name: 'Senaryo Ekle' }).click()
  await page.getByRole('button', { name: 'Senaryoyu Simüle Et' }).click()

  await page.getByPlaceholder('örn. 500').fill('500')
  await page.getByPlaceholder('örn. 1000').fill('200')
  await page.getByRole('button', { name: 'Hesapla', exact: true }).click()
  await expect(page.getByText('Fizibilite')).toBeVisible()

  await page.getByRole('button', { name: 'Sıfırla', exact: true }).click()
  await expect(page.getByText('Toplam Harcama')).toHaveCount(0)
})

test('media planning: simulate, charts, save/load/reconcile/delete, Excel import', async ({ page }) => {
  await uiLogin(page)
  await openCampaign(page, 'Petrol Ofisi', 'AutoMatic Filo')
  await page.getByRole('tab', { name: 'Medya Planlama' }).click()

  await page.getByRole('button', { name: 'Preset', exact: true }).click()
  await expect(page.getByText('Model Lead').first()).toBeVisible()

  for (const s of ['Maksimum', 'Minimum', 'Optimum']) {
    await page.getByRole('button', { name: s }).click()
  }
  for (const t of ['Carryover & Adstock', 'Saturation', 'Reach & Frequency', 'Haftalık Lead', 'Funnel Projeksiyon']) {
    await page.getByRole('button', { name: t }).click()
  }
  await expect(page.getByText('Optimal Harcama Onerisi')).toBeVisible()
  await page.getByRole('button', { name: 'Google Ads', exact: true }).click()
  await page.getByRole('button', { name: 'Preset', exact: true }).click()
  await expect(page.getByText('Model Lead').first()).toBeVisible()
  // Headline KPIs must show numbers: they used to read summary keys the API
  // never returns (total_leads vs total_leads_mmm) and always rendered "-".
  for (const kpi of ['Model Lead', 'Funnel Lead', 'CPL (Model)']) {
    const value = page.getByText(kpi, { exact: true }).locator('xpath=following-sibling::p[1]')
    await expect(value).toHaveText(/\d/)
  }

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSV İndir' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^dijital_plan_google_.*\.csv$/)

  // Save → list → reconcile against the DDA run from the previous test → load → delete
  const planName = `E2E Plan ${Date.now()}`
  const totalLabel = page.getByText(/^Toplam: /).first()
  // Make the plan differ from the channel preset, so a preset overwrite is detectable.
  const presetTotal = await totalLabel.innerText()
  await page.locator('input[type=number][placeholder="0"]').first().fill('7777000')
  await expect(totalLabel).not.toHaveText(presetTotal)
  await expect(page.getByRole('button', { name: 'Kaydet', exact: true }).first()).toBeVisible()
  const savedTotal = await totalLabel.innerText()
  await page.getByRole('button', { name: 'Kaydet', exact: true }).first().click()
  await page.getByPlaceholder('Simülasyon adı...').fill(planName)
  await page.getByPlaceholder('Simülasyon adı...').press('Enter')
  await page.getByRole('button', { name: 'Yükle', exact: true }).click()
  await expect(page.getByText(planName)).toBeVisible()
  await page.getByRole('button', { name: `${planName} planını gerçekleşmeyle doğrula` }).click()
  await expect(page.getByText(/Plan vs Gerçekleşme|Sağlama verisi yok/).first()).toBeVisible()
  // Load it while a different channel is selected: the plan (Google) must win
  // over the preset that switching channels loads.
  await page.getByRole('button', { name: 'Meta Ads', exact: true }).click()
  await expect(totalLabel).not.toHaveText(savedTotal)
  if (!(await page.getByText(planName).isVisible())) {
    await page.getByRole('button', { name: 'Yükle', exact: true }).click() // the list toggles
  }
  // Switching to the plan's channel re-fetches that channel's presets; check the
  // total only after that response has landed, or a late overwrite slips by.
  const presetsLoaded = page.waitForResponse(r => r.url().includes('/api/media-planning/presets/'))
  await page.getByText(planName).click()
  await presetsLoaded
  await page.waitForTimeout(300) // let React apply the response
  await expect(totalLabel).toHaveText(savedTotal)
  await expect(page.getByTestId('spend-source')).toContainText(`kayıtlı plan “${planName}”`)
  await page.getByRole('button', { name: 'Yükle', exact: true }).click()
  await expect(page.getByText(planName, { exact: true })).toBeVisible()
  // Row actions are reachable without hover (touch/keyboard) and named for screen readers.
  await page.setViewportSize({ width: 390, height: 844 })
  const del = page.getByRole('button', { name: `${planName} planını sil` })
  // poll: the button fades in via a CSS transition after the resize
  await expect.poll(() => del.evaluate(el => getComputedStyle(el).opacity)).toBe('1')
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: `${planName} planını sil` }).click()
  await expect(page.getByText(planName, { exact: true })).toHaveCount(0)

  // Excel import of a real .xlsx media plan
  const XLSX = (await import('xlsx')).default
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Mecra', 'Site/Network', 'Net Yayın Bedeli'],
    ['Meta', 'Instagram', 120000],
    ['Google', 'Search', 80000],
  ]), 'Plan')
  await page.locator('input[type=file][accept=".xlsx,.xls,.csv"]').setInputFiles({
    name: 'plan.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }),
  })
  const dialog = page.getByRole('dialog', { name: 'Plan içe aktarma' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Eşit' }).click()
  // Meta is listed first; Google is the selected channel, so this switches channels.
  await dialog.getByRole('button', { name: 'Uygula', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Meta Ads', exact: true })).toHaveClass(/text-white/)
  await expect(totalLabel).toHaveText('Toplam: 120K TL') // the imported Meta line, not Meta's preset
  await expect(page.getByText('Model Lead').first()).toBeVisible()
})

test('a reload keeps the user signed in on the same campaign and tab', async ({ page }) => {
  await uiLogin(page)
  await openCampaign(page, 'Petrol Ofisi', 'Premium Market')
  await page.getByRole('tab', { name: 'Attribution', exact: true }).click()

  await page.reload()
  await expect(page.locator('header').first()).toContainText('Premium Market')
  await expect(page.getByRole('tab', { name: 'Attribution', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('input[type=password]')).toHaveCount(0)
})

test('an invalid stored token lands on the login page and is discarded', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('th_token', 'not-a-valid-jwt')
      sessionStorage.setItem('seeded', '1')
    }
  })
  await page.goto('/')
  await expect(page.locator('input[type=password]')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('th_token'))).toBeNull()
})

test('logout forgets the session and the previous campaign', async ({ page }) => {
  await uiLogin(page)
  await openCampaign(page, 'Petrol Ofisi', 'Premium Market')
  await page.getByRole('button', { name: 'Oturumu kapat' }).click()
  await expect(page.locator('input[type=password]')).toBeVisible()

  await page.reload()
  await expect(page.locator('input[type=password]')).toBeVisible()

  // Signing back in starts at the campaign picker, not the old campaign.
  await uiLogin(page)
  await expect(page.locator('header').first()).not.toContainText('Premium Market')
})

test('a token that expires mid-session signs the user out', async ({ page }) => {
  await uiLogin(page)
  await openCampaign(page, 'Petrol Ofisi', 'Premium Market')
  // Let the campaign's own requests finish first, so the 401 is triggered by
  // the click below rather than racing in-flight loads.
  await page.waitForLoadState('networkidle')
  // From now on the server rejects the token, as it would after expiry.
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { detail: 'Invalid or expired token' } }))
  await page.getByRole('button', { name: /Kampanyalar/ }).click()
  await expect(page.locator('input[type=password]')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('th_token'))).toBeNull()
})

async function mockBigQueryConnect(page) {
  await page.route('**/api/integrations/bigquery/connect**', route => route.fulfill({
    json: { event_tables: 3, first_date: '2026-01-01', last_date: '2026-06-30' },
  }))
}

async function connectWithUpload(page) {
  await page.getByPlaceholder('unicef-bagis').fill('demo-project')
  await page.getByPlaceholder('analytics_358380518').fill('demo_dataset')
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'creds.json', mimeType: 'application/json', buffer: Buffer.from('{}'),
  })
  await page.getByRole('button', { name: 'Bağlan', exact: true }).click()
}

test('the BigQuery table mapping is remembered for the campaign', async ({ page }) => {
  await mockBigQueryConnect(page)
  await uiLogin(page)
  await openCampaign(page, 'Petrol Ofisi', 'Premium Market')
  await page.getByRole('tab', { name: 'Attribution', exact: true }).click()
  await page.getByRole('tab', { name: 'BigQuery (Tablo)' }).click()
  await connectWithUpload(page)

  await page.getByPlaceholder('crm_events').fill('crm_touchpoints')
  await page.getByPlaceholder('user_id').fill('customer_id')
  await page.getByPlaceholder('event_time').fill('touch_ts')
  await page.getByRole('button', { name: 'Source + Medium' }).click()
  await page.getByPlaceholder('source', { exact: true }).fill('utm_source')
  await page.getByPlaceholder('medium', { exact: true }).fill('utm_medium')
  await page.getByRole('button', { name: 'Olay + değerler' }).click()
  await page.getByPlaceholder('event_name').fill('event')
  await page.getByPlaceholder('signup, purchase').fill('lead_form, demo_request')
  await page.getByRole('button', { name: 'Eşlemeyi kaydet' }).click()
  await expect(page.getByText('Eşleme kaydedildi')).toBeVisible()

  // A fresh page load: the campaign's mapping comes back from the server.
  await page.reload()
  await page.getByRole('tab', { name: 'BigQuery (Tablo)' }).click()
  await connectWithUpload(page)
  await expect(page.getByPlaceholder('crm_events')).toHaveValue('crm_touchpoints')
  await expect(page.getByPlaceholder('source', { exact: true })).toHaveValue('utm_source')
  await expect(page.getByPlaceholder('signup, purchase')).toHaveValue('lead_form, demo_request')
  await expect(page.getByRole('button', { name: 'Attribution Analizi Başlat' })).toBeEnabled()
})

test('a campaign with stored credentials connects without re-uploading JSON', async ({ page }) => {
  // Stored credentials need real BigQuery; the endpoints are covered by pytest,
  // here only the UI wiring is exercised.
  await page.route('**/api/integrations/bigquery/saved-config**', route => route.fulfill({
    json: { project: 'saved-proj', dataset: 'saved_ds', has_credentials: true, table_mapping: null },
  }))
  let reconnects = 0
  await page.route('**/api/integrations/bigquery/reconnect**', route => {
    reconnects += 1
    return route.fulfill({ json: { ok: true, event_tables: 7, first_date: '2026-02-01', last_date: '2026-07-01', project: 'saved-proj', dataset: 'saved_ds' } })
  })
  await uiLogin(page)
  await openCampaign(page, 'Petrol Ofisi', 'Premium Market')
  await page.getByRole('tab', { name: 'Attribution', exact: true }).click()

  await expect(page.getByText('saved-proj.saved_ds')).toBeVisible()
  await expect(page.getByPlaceholder('unicef-bagis')).toHaveValue('saved-proj')
  await page.getByRole('button', { name: 'Kayıtlı bağlantıyla devam et' }).click()
  await expect(page.getByText('BQ Bağlı: 7 tablo')).toBeVisible()
  expect(reconnects).toBe(1)
})

test('traffic (awareness) campaign: create in UI, visit wording everywhere, reach KPIs in planning', async ({ page, request }) => {
  const clientName = `Trafik Müşteri ${Date.now()}`
  await uiLogin(page)

  // Create client + campaign through the picker with the new objective.
  await page.getByText('+ Yeni Müşteri').click()
  await page.getByPlaceholder('Müşteri adı...').fill(clientName)
  await page.getByRole('button', { name: 'Trafik', exact: true }).click()
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  await page.getByText(clientName).click()
  await page.getByText('+ Yeni Kampanya').click()
  await page.getByPlaceholder('Kampanya adı...').fill('Lansman')
  await page.getByPlaceholder('Bütçe (TL)...').fill('15000000')
  await expect(page.getByRole('button', { name: 'Trafik', exact: true })).toHaveAttribute('aria-pressed', 'true') // inherited
  await expect(page.getByPlaceholder('Lead başına değer (₺, opsiyonel)...')).toHaveCount(0) // lead-only field
  await page.getByRole('button', { name: 'Oluştur', exact: true }).click()
  await expect(page.getByText('Erişim & Trafik').first()).toBeVisible()

  // Seed a run for it through the API (qualified visits as conversions).
  const headers = await apiLogin(request)
  const clients = await (await request.get('/api/clients', { headers })).json()
  const client = clients.find(c => c.name === clientName)
  const camps = await (await request.get(`/api/clients/${client.id}/campaigns`, { headers })).json()
  expect(camps[0].objective).toBe('traffic')
  const run = await request.post('/api/dda/run-from-csv', {
    headers, params: { campaign_id: camps[0].id },
    multipart: { file: { name: 'j.csv', mimeType: 'text/csv', buffer: readFileSync('data/sample/journeys_sample.csv') } },
  })
  expect(run.ok()).toBeTruthy()

  await page.getByText('Lansman', { exact: true }).click()
  await page.getByRole('tab', { name: 'Attribution', exact: true }).click()
  await expect(page.getByText('Kanal Bazlı Atfedilen Ziyaret')).toBeVisible()

  const spendInputs = page.locator('input[type=number][placeholder="0"]')
  await spendInputs.nth(0).fill('100000')
  await page.getByRole('button', { name: 'Simüle Et', exact: true }).click()
  await expect(page.getByText('Toplam Ziyaret').first()).toBeVisible()
  await expect(page.getByText('Ort. Maliyet/Ziyaret')).toBeVisible()
  await expect(page.getByText('Hedef Maliyet/Ziyaret Planlayıcı')).toBeVisible()
  await expect(page.getByText('Toplam Lead')).toHaveCount(0)

  await page.getByRole('tab', { name: 'Medya Planlama' }).click()
  await page.getByRole('button', { name: 'Preset', exact: true }).click()
  await expect(page.getByText('Erişim (son hafta)')).toBeVisible()
  for (const kpi of ['Erişim (son hafta)', 'Ort. CPM', 'Ort. CPC']) {
    await expect(page.getByText(kpi, { exact: true }).locator('xpath=following-sibling::p[1]')).toHaveText(/\d/)
  }
  await expect(page.getByText('Model Lead')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Haftalık Lead' })).toHaveCount(0)
  // Optimal/saturation spends come from the lead response curve: hidden for traffic.
  await expect(page.getByText('Optimal Harcama Onerisi')).toHaveCount(0)
  await page.getByRole('button', { name: 'Saturation', exact: true }).click()
  await expect(page.getByText('Doygunluk Esigi')).toHaveCount(0)

  // A broad-audience brief must be able to set its own universe; the default
  // (sized for a narrow B2B audience) saturates reach.
  // Realistic weekly spend (the channel preset is sized for a 55M TL B2B plan
  // and saturates reach at any audience size).
  const weekInputs = page.locator('input[type=number][placeholder="0"]')
  for (let i = 0; i < await weekInputs.count(); i++) await weekInputs.nth(i).fill('100000')
  const reachValue = page.getByText('Erişim (son hafta)', { exact: true }).locator('xpath=following-sibling::p[1]')
  const reachPct = async () => parseFloat((await reachValue.innerText()).replace('%', ''))
  // 12 × 100K TL at ~80 TL CPM ≈ 15M impressions: ≈97.6% of the default 4M
  // audience (wait for that re-simulation, not the preset's 100%), ≈31% of 40M.
  await expect.poll(reachPct, { timeout: 10_000 }).toBeLessThan(99.5)
  expect(await reachPct()).toBeGreaterThan(90)
  await page.getByRole('button', { name: /Gelişmiş Ayarlar/ }).click()
  await page.getByLabel('Hedef Kitle (kişi)').fill('40000000')
  await expect.poll(reachPct, { timeout: 10_000 }).toBeLessThan(50)

  // Placeholders show the selected channel's real defaults (they used to read a
  // key the presets API never returns and always showed generic values, which
  // happen to equal Meta's — hence checking YouTube).
  await page.getByRole('button', { name: 'YouTube', exact: true }).click()
  await expect(page.getByLabel('Hedef Kitle (kişi)')).toHaveAttribute('placeholder', '6000000')
})

test('multi-channel import: all lines incl. planning-only placements, agency CPM, save all', async ({ page }) => {
  await uiLogin(page)
  await openCampaign(page, 'Petrol Ofisi', 'AutoMatic Filo')
  await page.getByRole('tab', { name: 'Medya Planlama' }).click()

  const XLSX = (await import('xlsx')).default
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Marka:', 'Bonus Yalıtım'],
    ['Kampanya Adı:', 'E2E Lansman'],
    [],
    ['Mecra', 'Site/Network', 'Net Yayın Bedeli', 'CPM'],
    ['YouTube', 'Masthead + Bumper', 4500000, ''],
    ['Google Ads', 'Search', 2250000, ''],
    ['DV360', 'Programatik video', 1500000, ''],
    ['Meta', 'Reach + Traffic', 2250000, ''],
    ['TikTok', 'Topview + In-Feed', 1500000, ''],
    ['LinkedIn', 'Reach', 600000, ''],
    ['X (Twitter)', 'Reach + Traffic (Video Post)', 450000, ''],
    ['Maçkolik', 'Push Notification', 450000, ''],
    ['Haber Siteleri', 'Masthead (5 haber sitesi)', 1200000, 25],
    ['TV Ekstra', 'Video', 300000, ''],
  ]), 'Plan')
  await page.locator('input[type=file][accept=".xlsx,.xls,.csv"]').setInputFiles({
    name: 'bonus.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }),
  })
  const dialog = page.getByRole('dialog', { name: 'Plan içe aktarma' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Eşlenmeyen Satırlar')).toHaveCount(0) // X, Maçkolik, news, TV Ekstra now map
  await dialog.getByRole('button', { name: 'Tüm kanalları uygula (10)' }).click()

  const summary = page.getByRole('region', { name: 'İçe aktarılan plan özeti' })
  await expect(summary).toBeVisible()
  const totalRow = summary.locator('tr', { hasText: 'Toplam' })
  await expect(totalRow).toContainText('15.0M')
  await expect(summary.locator('tbody tr')).toHaveCount(11) // 10 channels + total
  const news = summary.locator('tr', { hasText: 'Haber Siteleri' })
  await expect(news).toContainText('Excel') // agency CPM from the file
  await expect(news).not.toContainText('yer tutucu')
  await expect(summary.locator('tr', { hasText: 'X (Twitter)' })).toContainText('yer tutucu')
  await expect(news.locator('td').nth(3)).toHaveText('48.0M') // 1.2M TL / 25 TL CPM × 1000

  // The spend editor follows the imported plan, not the channel's example preset.
  const editorTotal = page.getByText(/^Toplam: /).first()
  const source = page.getByTestId('spend-source')
  await expect(editorTotal).toHaveText('Toplam: 2.3M TL') // Meta line: 2.25M
  await expect(source).toContainText('içe aktarılan plan (E2E Lansman)')
  await page.getByRole('button', { name: 'TikTok', exact: true }).click()
  await expect(editorTotal).toHaveText('Toplam: 1.5M TL')
  await expect(source).toContainText('içe aktarılan plan')
  // ...and survives leaving the tab.
  await page.getByRole('tab', { name: 'Unified Rapor' }).click()
  await page.getByRole('tab', { name: 'Medya Planlama' }).click()
  await expect(page.getByRole('button', { name: 'İçe Aktarılan Plan' })).toBeVisible()
  await expect(editorTotal).toHaveText('Toplam: 2.3M TL')
  await page.getByRole('button', { name: 'Preset', exact: true }).click()
  await expect(source).toContainText("örnek preset")
  await page.getByRole('button', { name: 'İçe Aktarılan Plan' }).click()
  await dialog.getByRole('button', { name: 'Tüm kanalları uygula (10)' }).click()
  await expect(summary).toBeVisible()

  await summary.getByRole('button', { name: 'Tüm kanalları kaydet (10)' }).click()
  await expect(summary.getByText('10 plan kaydedildi')).toBeVisible()

  // "Detay" moves one channel into the editor without the preset overwriting it.
  await summary.locator('tr', { hasText: 'YouTube' }).getByRole('button', { name: 'Detay' }).click()
  await expect(page.getByRole('button', { name: 'YouTube', exact: true })).toHaveClass(/text-white/)
  await expect(page.getByText(/^Toplam: /).first()).toHaveText('Toplam: 4.5M TL')

  // A single "Uygula" keeps the import available for the other channels.
  await page.getByRole('button', { name: 'İçe Aktarılan Plan' }).click()
  await dialog.getByRole('button', { name: 'Uygula', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'İçe Aktarılan Plan' })).toBeVisible()
})

test('mixed-unit agency plan: CPC/CPV lines, total row, news sites by name', async ({ page }) => {
  await uiLogin(page)
  await openCampaign(page, 'Petrol Ofisi', 'AutoMatic Filo')
  await page.getByRole('tab', { name: 'Medya Planlama' }).click()

  // One "unit cost" and one "planned quantity" column shared by CPM, CPC and CPV lines.
  const XLSX = (await import('xlsx')).default
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Kampanya Adı:', 'Karma Birim'],
    ['Mecra', 'Site/Network', 'Net Yayın Bedeli', 'Birim Maliyet (CPM/CPC, TL)', 'Planlanan Gösterim / Tıklama'],
    ['Google Ads', 'Search – Erkek Hedef Kitle', 200000, 5, 40000],
    ['YouTube', 'Masthead', 1000000, 50, 20000000],
    ['YouTube', 'TrueView In-Stream', 1000000, 0.3, 3333333],
    ['Sözcü', 'sozcu.com.tr – Masthead', 500000, 100, 5000000],
    ['TOPLAM', '', 2700000, '', ''],
  ]), 'Plan')
  await page.locator('input[type=file][accept=".xlsx,.xls,.csv"]').setInputFiles({
    name: 'karma.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }),
  })
  const dialog = page.getByRole('dialog', { name: 'Plan içe aktarma' })
  await expect(dialog.getByTestId('skipped-totals')).toContainText('TOPLAM')
  await expect(dialog.getByText('Eşlenmeyen Satırlar')).toHaveCount(0) // Sözcü maps to news sites
  await dialog.getByRole('button', { name: 'Tüm kanalları uygula (3)' }).click()

  const summary = page.getByRole('region', { name: 'İçe aktarılan plan özeti' })
  await expect(summary.locator('tr', { hasText: 'Toplam' })).toContainText('2.7M')
  // Search: 40K is clicks, not impressions → default CPM, clicks from the plan, CPC = 5 TL.
  const google = summary.locator('tr', { hasText: 'Google Ads' })
  await expect(google.locator('td').nth(2)).toContainText('vars.')
  await expect(google.locator('td').nth(4)).toHaveText(/^40\.0K/)
  await expect(google.locator('td').nth(5)).toHaveText('5')
  // YouTube: TrueView views stay out of the CPM → masthead's 50 TL, not ~(2M / 23.3M).
  await expect(summary.locator('tr', { hasText: 'YouTube' }).locator('td').nth(2)).toContainText('50')
  await expect(summary.locator('tr', { hasText: 'Haber Siteleri' }).locator('td').nth(2)).toContainText('100')

  // In the editor too: planned clicks drive Google's clicks.
  await google.getByRole('button', { name: 'Detay' }).click()
  await expect(page.getByTestId('spend-source')).toContainText('planlanan tıklama 40.0K')
  await expect(page.getByText('Clicks', { exact: true }).first().locator('xpath=following-sibling::p[1]')).toHaveText('40.0K')
})
