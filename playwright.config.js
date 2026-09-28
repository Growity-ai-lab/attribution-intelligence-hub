// Browser smoke tests: build the frontend first (`npm run build`), then
// `npx playwright test`. The config starts the FastAPI app (which serves
// frontend/dist) against a throwaway SQLite database.
import { defineConfig } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = Number(process.env.E2E_PORT || 8765)
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'e2e-admin-pass'
const dbDir = mkdtempSync(join(tmpdir(), 'hub-e2e-'))

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // tests share one server + database
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Sandboxes with a preinstalled Chromium can point at it instead of `playwright install`.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: `python -m uvicorn backend.main:app --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: `sqlite:///${join(dbDir, 'e2e.db')}`,
      AUTH_SECRET_KEY: 'e2e-secret',
      AUTH_ADMIN_PASSWORD: ADMIN_PASSWORD,
    },
  },
})
