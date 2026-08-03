import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const themePath = path.resolve(__dirname, '../pages/Ops/opsTheme.css')
const themeSource = fs.readFileSync(themePath, 'utf8')

type Rgb = readonly [number, number, number]

const readHexToken = (token: string): string => {
  const match = themeSource.match(new RegExp(`--${token}:\\s*(#[0-9a-f]{6});`, 'iu'))
  const value = match?.[1]
  if (!value) throw new Error(`Missing hexadecimal Ops theme token: ${token}`)
  return value
}

const parseHex = (value: string): Rgb => [
  Number.parseInt(value.slice(1, 3), 16),
  Number.parseInt(value.slice(3, 5), 16),
  Number.parseInt(value.slice(5, 7), 16),
]

const relativeLuminance = (value: string): number => {
  const channels = parseHex(value).map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}

const contrastRatio = (first: string, second: string): number => {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('Clear Current Glass source contract', () => {
  test('keeps the approved theme scoped and free of decorative CSS gradients', () => {
    expect(themeSource).toContain('html[data-ops-visual-theme="clear-current"]')
    expect(themeSource).not.toMatch(/\b(?:linear|radial|conic)-gradient\s*\(/iu)
  })

  test('retains motion, transparency, and unsupported-browser fallbacks', () => {
    expect(themeSource).toContain('@media (prefers-reduced-motion: reduce)')
    expect(themeSource).toContain('@media (prefers-reduced-transparency: reduce)')
    expect(themeSource).toContain('@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))')
    expect(themeSource).toContain('[data-ops-reduced-transparency="true"]')
    expect(themeSource).toContain('backdrop-filter: none !important')
  })

  test('keeps primary and muted text AA-compliant on the exposed substrate', () => {
    const substrate = readHexToken('ops-glass-air')
    const primary = readHexToken('ops-glass-ink')
    const muted = readHexToken('ops-glass-muted')

    expect(contrastRatio(primary, substrate)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(muted, substrate)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#ffffff', primary)).toBeGreaterThanOrEqual(4.5)
  })

  test('preserves the no-horizontal-scroll finance ledger at mobile widths', () => {
    expect(themeSource).toContain('@media (max-width: 800px)')
    expect(themeSource).toContain('section[aria-labelledby="performance-table-heading"] > .overflow-x-auto')
    expect(themeSource).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(themeSource).toContain('min-height: 44px')
  })
})
