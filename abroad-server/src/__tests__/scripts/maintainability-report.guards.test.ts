import path from 'node:path'

import * as maintainabilityReport from '../../../scripts/maintainability-report'
import { createMaintainabilityTestContext } from './maintainabilityReportTestUtils'

const context = createMaintainabilityTestContext()

afterEach(async () => {
  await context.reset()
})

describe('utility guards', () => {
  it('builds analysis options using failOnError', () => {
    expect(maintainabilityReport.buildAnalysisOptions({ failOnError: true } as maintainabilityReport.CliOptions).ignoreErrors).toBe(false)
    expect(maintainabilityReport.buildAnalysisOptions({ failOnError: false } as maintainabilityReport.CliOptions).ignoreErrors).toBe(true)
  })

  it('matches ignore paths and supported sources', () => {
    const matcher = maintainabilityReport.buildIgnoreMatcher(['api', 'lib'])
    expect(matcher('api/index.ts')).toBe(true)
    expect(matcher('services/index.ts')).toBe(false)
    expect(maintainabilityReport.isSupportedSource('index.tsx')).toBe(true)
    expect(maintainabilityReport.isSupportedSource('types.d.ts')).toBe(false)
    expect(maintainabilityReport.isSupportedSource('script.js')).toBe(false)
  })

  it('aggregates module errors with source locations', () => {
    const modules = [
      context.buildModuleReport({ errors: [], srcPath: 'clean.ts' }),
      context.buildModuleReport({ errors: [new Error('boom'), 'text error'], srcPath: 'broken.ts' }),
    ]
    const errors = maintainabilityReport.collectModuleErrors(modules)

    expect(errors).toEqual(['broken.ts: boom', 'broken.ts: text error'])
  })

  it('calculates normalized averages and relative paths', () => {
    const rows: maintainabilityReport.MaintainabilityRow[] = [
      { cyclomaticComplexity: 1, halsteadVolume: 1, logicalSloc: 1, maintainabilityIndex: 171, normalizedMaintainability: 100, path: 'a.ts', physicalSloc: 1 },
      { cyclomaticComplexity: 1, halsteadVolume: 1, logicalSloc: 1, maintainabilityIndex: 85.5, normalizedMaintainability: maintainabilityReport.normalizeMaintainability(85.5), path: 'b.ts', physicalSloc: 1 },
    ]
    expect(maintainabilityReport.calculateAverageNormalizedMaintainability(rows)).toBeCloseTo(
      (100 + maintainabilityReport.normalizeMaintainability(85.5)) / 2,
    )
    expect(maintainabilityReport.calculateAverageNormalizedMaintainability([])).toBe(0)

    const root = '/tmp/project'
    expect(maintainabilityReport.toNormalizedRelativePath(root, path.join(root, 'src/index.ts'))).toBe('src/index.ts')
  })

  it('strips leading root segments safely', () => {
    const root = path.join('tmp', 'project')
    expect(maintainabilityReport.stripLeadingRootSegment('/absolute/path', root)).toBe('/absolute/path')
    expect(maintainabilityReport.stripLeadingRootSegment('./project/src', root)).toBe('src')
    expect(maintainabilityReport.stripLeadingRootSegment('project', root)).toBe('.')
  })
})
