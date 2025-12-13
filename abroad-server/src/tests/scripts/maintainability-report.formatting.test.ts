import fs from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

import * as maintainabilityReport from '../../../scripts/maintainability-report'
import { createMaintainabilityTestContext } from './maintainabilityReportTestUtils'

const context = createMaintainabilityTestContext()

afterEach(async () => {
  await context.reset()
})

describe('formatting helpers', () => {
  it('formats diagnostics with and without source locations', () => {
    const sourceFile = ts.createSourceFile('demo.ts', 'const value = 1;', ts.ScriptTarget.ES2020, true)
    const diagnostics = maintainabilityReport.formatDiagnostics('demo.ts', [
      {
        category: ts.DiagnosticCategory.Error,
        code: 9999,
        file: sourceFile,
        length: 1,
        messageText: 'Oops',
        start: 6,
      },
      {
        category: ts.DiagnosticCategory.Error,
        code: 1000,
        file: undefined,
        length: 0,
        messageText: 'Fallback',
        start: undefined,
      },
    ])

    expect(diagnostics[0]).toContain('demo.ts:1:7 Oops')
    expect(diagnostics[1]).toBe('demo.ts: Fallback')
  })

  it('extracts error messages from multiple inputs', () => {
    expect(maintainabilityReport.extractErrorMessage(new Error('boom'))).toBe('boom')
    expect(maintainabilityReport.extractErrorMessage('plain')).toBe('plain')
    expect(maintainabilityReport.extractErrorMessage({ key: 'value' })).toBe('{"key":"value"}')
  })

  it('builds maintainability rows and tables with sorted output', () => {
    const baseModule = context.buildModuleReport()
    const rows = maintainabilityReport.buildMaintainabilityRows([
      context.buildModuleReport({
        aggregate: { ...baseModule.aggregate, sloc: { logical: 2, physical: 3 } },
        maintainability: 120,
      }),
    ])
    const sorted = maintainabilityReport.sortRows([
      { ...rows[0], maintainabilityIndex: 200 },
      { ...rows[0], maintainabilityIndex: 100 },
    ])

    expect(sorted[0].maintainabilityIndex).toBe(100)
    expect(rows[0].normalizedMaintainability).toBeCloseTo((120 / 171) * 100)

    const report: maintainabilityReport.MaintainabilityReport = {
      averageNormalizedMaintainability: maintainabilityReport.calculateAverageNormalizedMaintainability(rows),
      ignoredPaths: ['routes.ts'],
      minimumAverageMaintainability: 40,
      rows,
    }
    const table = maintainabilityReport.buildTable(report)

    expect(table).toContain('Maintainability report for 1 file')
    expect(table).toContain('routes.ts')
    expect(table).toContain('MI (%)')
  })

  it('renders reports in JSON and table formats', () => {
    const rows: maintainabilityReport.MaintainabilityRow[] = [
      {
        cyclomaticComplexity: 1,
        halsteadVolume: 1,
        logicalSloc: 1,
        maintainabilityIndex: 100,
        normalizedMaintainability: 58.48,
        path: 'src/index.ts',
        physicalSloc: 1,
      },
    ]
    const report: maintainabilityReport.MaintainabilityReport = {
      averageNormalizedMaintainability: 58.48,
      ignoredPaths: [],
      minimumAverageMaintainability: 40,
      rows,
    }

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    maintainabilityReport.renderReport(report, {
      failOnError: true,
      format: 'json',
      ignoredPaths: [],
      minimumAverageMaintainability: 40,
      sourceRoot: '',
    })
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(report, null, 2))

    logSpy.mockClear()
    maintainabilityReport.renderReport(
      { ...report, ignoredPaths: ['routes.ts'] },
      {
        failOnError: true,
        format: 'table',
        ignoredPaths: ['routes.ts'],
        minimumAverageMaintainability: 40,
        outputPath: '/tmp/out.json',
        sourceRoot: '',
      },
    )
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Maintainability report for 1 file'))
    expect(logSpy).toHaveBeenCalledWith('\nJSON report written to /tmp/out.json')
  })

  it('persists report payloads to disk', async () => {
    const dir = await context.createTempDir('maintainability-persist-')
    const outputPath = path.join(dir, 'reports/report.json')
    const report: maintainabilityReport.MaintainabilityReport = {
      averageNormalizedMaintainability: 50,
      ignoredPaths: ['routes.ts'],
      minimumAverageMaintainability: 40,
      rows: [],
    }

    await maintainabilityReport.persistReport(report, outputPath)

    const persisted = await fs.readFile(outputPath, 'utf8')
    expect(JSON.parse(persisted)).toEqual(report)
  })
})
