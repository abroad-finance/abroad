import os from 'node:os'
import path from 'node:path'

import * as maintainabilityReport from '../../../scripts/maintainability-report'
import { createMaintainabilityTestContext } from './maintainabilityReportTestUtils'

const context = createMaintainabilityTestContext()

afterEach(async () => {
  await context.reset()
})

describe('parseCliOptions and normalization helpers', () => {
  it('parses defaults and resolves paths relative to cwd', () => {
    const cwd = path.join(os.tmpdir(), 'maintainability-defaults')
    const options = maintainabilityReport.parseCliOptions(['node', 'script'], cwd)

    expect(options.failOnError).toBe(true)
    expect(options.format).toBe('table')
    expect(options.minimumAverageMaintainability).toBe(40)
    expect(options.ignoredPaths).toContain('routes.ts')
    expect(options.sourceRoot).toBe(path.join(cwd, 'src'))
    expect(options.outputPath).toBeUndefined()
  })

  it('parses flags and normalizes ignore paths with duplicates removed', () => {
    const cwd = path.join(os.tmpdir(), 'maintainability-flags')
    const options = maintainabilityReport.parseCliOptions(
      [
        'node',
        'script',
        '--format',
        'json',
        '--min-average',
        '55',
        '--ignore',
        ' foo/',
        'foo',
        '--ignore',
        'bar/baz',
        '--src',
        './packages/server',
        '--output',
        './reports/out.json',
        '--ignore-errors',
      ],
      cwd,
    )

    expect(options.failOnError).toBe(false)
    expect(options.format).toBe('json')
    expect(options.minimumAverageMaintainability).toBe(55)
    expect(options.ignoredPaths).toEqual(['routes.ts', 'foo', 'bar/baz'])
    expect(options.sourceRoot).toBe(path.join(cwd, 'packages/server'))
    expect(options.outputPath).toBe(path.join(cwd, 'reports/out.json'))
  })

  it('validates minimum average maintainability input', () => {
    expect(() => maintainabilityReport.parseMinimumAverageMaintainability('abc')).toThrow(
      'Minimum average maintainability must be a finite number. Received "abc".',
    )
    expect(() => maintainabilityReport.parseMinimumAverageMaintainability('-1')).toThrow(
      'Minimum average maintainability must be between 0 and 100 (inclusive).',
    )
    expect(() => maintainabilityReport.parseMinimumAverageMaintainability('101')).toThrow(
      'Minimum average maintainability must be between 0 and 100 (inclusive).',
    )
    expect(maintainabilityReport.parseMinimumAverageMaintainability('75')).toBe(75)
  })

  it('normalizes ignore paths and guards against invalid entries', () => {
    const root = path.join(os.tmpdir(), 'maintainability-normalize')

    expect(maintainabilityReport.normalizeIgnorePath('./src//', root)).toBe('src')
    expect(maintainabilityReport.normalizeIgnorePath(`${root}/nested`, root)).toBe('nested')
    expect(() => maintainabilityReport.normalizeIgnorePath('', root)).toThrow('Ignore path must not be empty')
    expect(() => maintainabilityReport.normalizeIgnorePath('.', root)).toThrow('Ignoring the source root is not supported')
    expect(() => maintainabilityReport.normalizeIgnorePath('../outside', root)).toThrow(
      `Ignore path ../outside is outside of the source root ${root}`,
    )

    const normalized = maintainabilityReport.normalizeIgnorePaths([' src', 'src/', 'features'], root)
    expect(normalized).toEqual(['src', 'features'])
  })

  it('normalizes maintainability values within bounds', () => {
    expect(maintainabilityReport.normalizeMaintainability(200)).toBe(100)
    expect(maintainabilityReport.normalizeMaintainability(-5)).toBe(0)
    expect(maintainabilityReport.normalizeMaintainability(85.5)).toBeCloseTo((85.5 / 171) * 100)
  })
})
