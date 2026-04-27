import { type Page, type TestInfo } from '@playwright/test'

export type ConsoleMessage = {
  type: string
  text: string
  url: string
}

export type NetworkError = {
  url: string
  status: number
  statusText: string
}

/**
 * Known expected noise in dev/localhost — not real bugs.
 * Extend this list when you encounter consistent false positives.
 */
const KNOWN_NOISE: RegExp[] = [
  // Tolgee i18n CORS: the service blocks requests from localhost (by design)
  /tolgee.*us-east1\.run\.app/i,
  /CORS.*tolgee/i,
  /tolgee.*CORS/i,
  // Generic "Failed to load resource" that Chromium emits after any CORS block.
  // We suppress it here because in this project CORS failures are always Tolgee.
  // If a real fetch fails you'll see a different, more descriptive message first.
  /Failed to load resource: net::ERR_FAILED/,
  // Firebase app initialization warnings in local dev
  /Firebase.*emulator/i,
  /No Firebase App/i,
]

export function isNoise(text: string): boolean {
  return KNOWN_NOISE.some(re => re.test(text))
}

/**
 * Attaches console and network error listeners to a Playwright Page.
 *
 * Returns:
 *  - `errors`       – console errors that are NOT known noise
 *  - `allErrors`    – every console error (including noise, for diagnostics)
 *  - `warnings`     – console warnings (not noise)
 *  - `networkErrors`– HTTP 4xx/5xx responses (excluding 401s)
 *
 * Usage:
 *   const { errors, networkErrors } = watchPage(page)
 *   await page.goto('/')
 *   await page.waitForLoadState('networkidle')
 *   expect(errors).toHaveLength(0)
 */
export function watchPage(page: Page) {
  const errors: ConsoleMessage[] = []
  const allErrors: ConsoleMessage[] = []
  const warnings: ConsoleMessage[] = []
  const networkErrors: NetworkError[] = []

  page.on('console', (msg) => {
    const entry: ConsoleMessage = {
      type: msg.type(),
      text: msg.text(),
      url: page.url(),
    }

    if (msg.type() === 'error') {
      allErrors.push(entry)
      if (!isNoise(entry.text)) errors.push(entry)
    }

    if (msg.type() === 'warning' && !isNoise(entry.text)) {
      warnings.push(entry)
    }
  })

  page.on('pageerror', (err) => {
    const entry: ConsoleMessage = { type: 'pageerror', text: err.message, url: page.url() }
    allErrors.push(entry)
    if (!isNoise(err.message)) errors.push(entry)
  })

  page.on('response', (res) => {
    if (res.status() >= 400 && res.status() < 600) {
      if (res.status() === 401) return          // expected when user is not authenticated
      if (isNoise(res.url())) return            // Tolgee / known services
      networkErrors.push({
        url: res.url(),
        status: res.status(),
        statusText: res.statusText(),
      })
    }
  })

  return {
    allErrors,
    errors,
    networkErrors,
    warnings,
  }
}

/**
 * Formats collected issues for readable test failure messages.
 */
export function formatIssues(
  errors: ConsoleMessage[],
  warnings: ConsoleMessage[],
  networkErrors: NetworkError[],
): string {
  const lines: string[] = []
  if (errors.length) {
    lines.push('── Console errors ──')
    errors.forEach(e => lines.push(`  [${e.type}] ${e.text}`))
  }
  if (networkErrors.length) {
    lines.push('── Network errors ──')
    networkErrors.forEach(e => lines.push(`  ${e.status} ${e.url}`))
  }
  if (warnings.length) {
    lines.push('── Warnings ──')
    warnings.forEach(w => lines.push(`  ${w.text}`))
  }
  return lines.length ? lines.join('\n') : '(none)'
}

/**
 * Attaches the full issue log (including noise for diagnostics) to the test report.
 */
export async function attachIssues(
  testInfo: TestInfo,
  errors: ConsoleMessage[],
  warnings: ConsoleMessage[],
  networkErrors: NetworkError[],
  allErrors: ConsoleMessage[] = [],
): Promise<void> {
  const lines: string[] = []

  if (errors.length || warnings.length || networkErrors.length) {
    lines.push(formatIssues(errors, warnings, networkErrors))
  }

  if (allErrors.length > errors.length) {
    lines.push('\n── Suppressed noise (known expected) ──')
    allErrors
      .filter(e => !errors.includes(e))
      .forEach(e => lines.push(`  ${e.text.slice(0, 120)}`))
  }

  if (lines.length === 0) return

  await testInfo.attach('console-and-network', {
    contentType: 'text/plain',
    body: Buffer.from(lines.join('\n')),
  })
}
