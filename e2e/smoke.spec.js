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
  await page.getByRole('button', { name: 'Kaydet', exact: true }).first().click()
  await page.getByPlaceholder('Simülasyon adı...').fill(planName)
  await page.getByPlaceholder('Simülasyon adı...').press('Enter')
  await page.getByRole('button', { name: 'Yükle', exact: true }).click()
  await expect(page.getByText(planName)).toBeVisible()
  await page.getByRole('button', { name: `${planName} planını gerçekleşmeyle doğrula` }).click()
  await expect(page.getByText(/Plan vs Gerçekleşme|Sağlama verisi yok/).first()).toBeVisible()
  await page.getByText(planName).click()
  await page.getByRole('button', { name: 'Yükle', exact: true }).click()
  await expect(page.getByText(planName)).toBeVisible()
  // Row actions are reachable without hover (touch/keyboard) and named for screen readers.
  await page.setViewportSize({ width: 390, height: 844 })
  const del = page.getByRole('button', { name: `${planName} planını sil` })
  // poll: the button fades in via a CSS transition after the resize
  await expect.poll(() => del.evaluate(el => getComputedStyle(el).opacity)).toBe('1')
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: `${planName} planını sil` }).click()
  await expect(page.getByText(planName)).toHaveCount(0)

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
  await dialog.getByRole('button', { name: 'Uygula', exact: true }).first().click()
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
