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

async function apiLogin(request) {
  const res = await request.post('/api/auth/login', {
    form: { username: 'admin', password: ADMIN_PASSWORD },
  })
  expect(res.ok()).toBeTruthy()
  return { Authorization: `Bearer ${(await res.json()).access_token}` }
}

async function findCampaign(request, headers, clientName, campaignName) {
  const clients = await (await request.get('/api/clients', { headers })).json()
  const client = clients.find(c => c.name === clientName)
  const campaigns = await (await request.get(`/api/clients/${client.id}/campaigns`, { headers })).json()
  return campaigns.find(c => c.name === campaignName).id
}

async function uiLogin(page) {
  await page.goto('/')
  await page.locator('input[type=password]').fill(ADMIN_PASSWORD)
  await page.locator('input:not([type=password])').first().fill('admin')
  await page.locator('input[type=password]').press('Enter')
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

  await uiLogin(page)
  await openCampaign(page, 'Petrol Ofisi', 'Premium Market')
  await expect(page.getByText('Son kayıtlı analiz gösteriliyor')).toBeVisible()
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
