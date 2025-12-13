import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import escomplex from 'typhonjs-escomplex'

import * as maintainabilityReport from '../../../scripts/maintainability-report'
import { createMaintainabilityTestContext } from './maintainabilityReportTestUtils'

const context = createMaintainabilityTestContext()

afterEach(async () => {
  await context.reset()
})

describe('analysis orchestration', () => {
  it('runs the maintainability analysis and writes output when thresholds are satisfied', async () => {
    const root = await context.createTempDir('maintainability-run-')
    await context.writeTempFile(root, 'index.ts', 'export const value = 1;')
    const outputPath = path.join(root, 'report.json')

    const analyzeSpy = jest.spyOn(escomplex, 'analyzeProject').mockReturnValue({
      modules: [context.buildModuleReport({ filePath: path.join(root, 'index.ts'), maintainability: 150, srcPath: 'index.ts' })],
      settings: {},
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

    const report = await maintainabilityReport.generateMaintainabilityReport({
      failOnError: true,
      format: 'table',
      ignoredPaths: [],
      minimumAverageMaintainability: 40,
      outputPath,
      sourceRoot: root,
    })

    expect(analyzeSpy).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalled()
    expect(report.averageNormalizedMaintainability).toBeGreaterThan(0)
    const persisted = await fs.readFile(outputPath, 'utf8')
    expect(JSON.parse(persisted).rows[0].path).toContain('index.ts')
  })

  it('logs diagnostics when transpilation reports issues', async () => {
    const root = await context.createTempDir('maintainability-diag-')
    await context.writeTempFile(root, 'index.ts', 'export const value =')
    jest.spyOn(escomplex, 'analyzeProject').mockReturnValue({
      modules: [context.buildModuleReport({ srcPath: 'index.ts' })],
      settings: {},
    })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    const report = await maintainabilityReport.generateMaintainabilityReport({
      failOnError: true,
      format: 'table',
      ignoredPaths: [],
      minimumAverageMaintainability: 10,
      sourceRoot: root,
    })

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toBe('Transpilation warnings:\n')
    expect(warnSpy.mock.calls[0][1]).toContain('index.ts')
    expect(report.rows).toHaveLength(1)
  })

  it('raises when complexity analysis reports errors and failOnError is true', async () => {
    const root = await context.createTempDir('maintainability-errors-')
    await context.writeTempFile(root, 'index.ts', 'export const value = 1;')
    jest.spyOn(escomplex, 'analyzeProject').mockReturnValue({
      modules: [context.buildModuleReport({ errors: [new Error('Unexpected token')], srcPath: 'index.ts' })],
      settings: {},
    })

    await expect(
      maintainabilityReport.generateMaintainabilityReport({
        failOnError: true,
        format: 'table',
        ignoredPaths: [],
        minimumAverageMaintainability: 10,
        sourceRoot: root,
      }),
    ).rejects.toThrow('Complexity analysis reported errors')
  })

  it('raises when maintainability drops below the configured threshold', async () => {
    const root = await context.createTempDir('maintainability-threshold-')
    await context.writeTempFile(root, 'index.ts', 'export const value = 1;')
    jest.spyOn(escomplex, 'analyzeProject').mockReturnValue({
      modules: [context.buildModuleReport({ maintainability: 1 })],
      settings: {},
    })

    await expect(
      maintainabilityReport.generateMaintainabilityReport({
        failOnError: true,
        format: 'table',
        ignoredPaths: [],
        minimumAverageMaintainability: 80,
        sourceRoot: root,
      }),
    ).rejects.toThrow('Combined average MI')
  })

  it('wraps errors when invoked through run()', async () => {
    const logger = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await maintainabilityReport.run({
      failOnError: true,
      format: 'table',
      ignoredPaths: [],
      minimumAverageMaintainability: 10,
      sourceRoot: path.join(os.tmpdir(), 'non-existent'),
    })

    expect(result).toBeUndefined()
    expect(process.exitCode).toBe(1)
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('Failed to generate maintainability report:'))
  })
})
