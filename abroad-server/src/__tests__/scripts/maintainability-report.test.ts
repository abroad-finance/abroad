import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import escomplex, { type ModuleReport } from 'typhonjs-escomplex'
import ts from 'typescript'

import * as maintainabilityReport from '../../scripts/maintainability-report'

const tempCleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  jest.restoreAllMocks()
  const cleanups = [...tempCleanups]
  tempCleanups.length = 0
  await Promise.all(cleanups.map(cleanup => cleanup()))
  process.exitCode = undefined
})

async function createTempDir(prefix: string = 'maintainability-'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  tempCleanups.push(() => fs.rm(dir, { force: true, recursive: true }))
  return dir
}

async function writeTempFile(root: string, relativePath: string, content: string): Promise<string> {
  const fullPath = path.join(root, relativePath)
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, content, 'utf8')
  return fullPath
}

function buildModuleReport(overrides: Partial<ModuleReport> = {}): ModuleReport {
  return {
    aggregate: overrides.aggregate ?? {
      aggregate: undefined,
      cyclomatic: 1,
      cyclomaticDensity: 1,
      halstead: {
        bugs: 0,
        difficulty: 0,
        effort: 0,
        length: 1,
        operands: { distinct: 1, identifiers: ['a'], total: 1 },
        operators: { distinct: 1, identifiers: ['='], total: 1 },
        time: 0,
        vocabulary: 2,
        volume: 1,
      },
      paramCount: 0,
      sloc: { logical: 1, physical: 1 },
    },
    aggregateAverage: overrides.aggregateAverage,
    classes: overrides.classes ?? [],
    dependencies: overrides.dependencies ?? [],
    errors: overrides.errors ?? [],
    filePath: overrides.filePath ?? path.join(os.tmpdir(), 'sample.ts'),
    lineEnd: overrides.lineEnd ?? 1,
    lineStart: overrides.lineStart ?? 0,
    maintainability: overrides.maintainability ?? 150,
    methodAverage: overrides.methodAverage,
    methods: overrides.methods ?? [],
    settings: overrides.settings ?? {},
    srcPath: overrides.srcPath ?? 'sample.ts',
    srcPathAlias: overrides.srcPathAlias,
  }
}

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

describe('file discovery and loading', () => {
  it('collects supported TypeScript sources while respecting ignore rules and symlinks', async () => {
    const root = await createTempDir('maintainability-files-')
    const included = await writeTempFile(root, 'main.ts', 'export const answer = 42;')
    await writeTempFile(root, 'ignored/file.ts', 'export const ignored = true;')
    await writeTempFile(root, 'types.d.ts', 'export interface IgnoreMe {}')
    await writeTempFile(root, 'script.js', 'console.log("noop")')
    const symlinkTarget = await writeTempFile(root, 'linked.ts', 'export const linked = true;')
    await fs.symlink(symlinkTarget, path.join(root, 'alias.ts'))

    const matcher = maintainabilityReport.buildIgnoreMatcher(['ignored'])
    const files = await maintainabilityReport.collectSourceFiles(root, matcher)

    expect(files.sort()).toEqual([included, symlinkTarget].sort())
  })

  it('loads sources and reports diagnostics with relative paths', async () => {
    const root = await createTempDir('maintainability-load-')
    const validFile = await writeTempFile(root, 'good.ts', 'export const value: number = 1;')
    const invalidFile = await writeTempFile(root, 'bad.ts', 'export const broken =')

    const { diagnostics, sources } = await maintainabilityReport.loadSources([validFile, invalidFile], root)

    expect(sources).toHaveLength(2)
    expect(sources[0].srcPath).toBe('good.ts')
    expect(sources[1].srcPath).toBe('bad.ts')
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]).toContain('bad.ts')
  })

  it('checks directory candidates before analysis', async () => {
    const root = await createTempDir('maintainability-assert-')
    const filePath = await writeTempFile(root, 'file.txt', 'content')
    await expect(maintainabilityReport.assertDirectory(root)).resolves.toBeUndefined()
    await expect(maintainabilityReport.assertDirectory(filePath)).rejects.toThrow(
      `Expected ${filePath} to be a directory`,
    )
  })
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
    const rows = maintainabilityReport.buildMaintainabilityRows([
      buildModuleReport({ maintainability: 120, aggregate: { ...buildModuleReport().aggregate, sloc: { logical: 2, physical: 3 } } }),
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
    const dir = await createTempDir('maintainability-persist-')
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

describe('analysis orchestration', () => {
  it('runs the maintainability analysis and writes output when thresholds are satisfied', async () => {
    const root = await createTempDir('maintainability-run-')
    await writeTempFile(root, 'index.ts', 'export const value = 1;')
    const outputPath = path.join(root, 'report.json')

    const analyzeSpy = jest.spyOn(escomplex, 'analyzeProject').mockReturnValue({
      modules: [buildModuleReport({ maintainability: 150, srcPath: 'index.ts', filePath: path.join(root, 'index.ts') })],
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
    const root = await createTempDir('maintainability-diag-')
    await writeTempFile(root, 'index.ts', 'export const value =')
    jest.spyOn(escomplex, 'analyzeProject').mockReturnValue({
      modules: [buildModuleReport({ srcPath: 'index.ts', filePath: path.join(root, 'index.ts') })],
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
    const root = await createTempDir('maintainability-errors-')
    await writeTempFile(root, 'index.ts', 'export const value = 1;')
    jest.spyOn(escomplex, 'analyzeProject').mockReturnValue({
      modules: [buildModuleReport({ errors: [new Error('Unexpected token')], srcPath: 'index.ts' })],
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
    const root = await createTempDir('maintainability-threshold-')
    await writeTempFile(root, 'index.ts', 'export const value = 1;')
    jest.spyOn(escomplex, 'analyzeProject').mockReturnValue({
      modules: [buildModuleReport({ maintainability: 1 })],
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
      buildModuleReport({ errors: [], srcPath: 'clean.ts' }),
      buildModuleReport({ errors: [new Error('boom'), 'text error'], srcPath: 'broken.ts' }),
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
