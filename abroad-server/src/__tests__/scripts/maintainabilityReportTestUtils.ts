import type { ModuleReport } from 'typhonjs-escomplex'

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const BASE_AGGREGATE: ModuleReport['aggregate'] = {
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
}

const cloneAggregate = (): ModuleReport['aggregate'] => ({
  aggregate: BASE_AGGREGATE.aggregate,
  cyclomatic: BASE_AGGREGATE.cyclomatic,
  cyclomaticDensity: BASE_AGGREGATE.cyclomaticDensity,
  halstead: {
    bugs: BASE_AGGREGATE.halstead.bugs,
    difficulty: BASE_AGGREGATE.halstead.difficulty,
    effort: BASE_AGGREGATE.halstead.effort,
    length: BASE_AGGREGATE.halstead.length,
    operands: {
      distinct: BASE_AGGREGATE.halstead.operands.distinct,
      identifiers: [...BASE_AGGREGATE.halstead.operands.identifiers],
      total: BASE_AGGREGATE.halstead.operands.total,
    },
    operators: {
      distinct: BASE_AGGREGATE.halstead.operators.distinct,
      identifiers: [...BASE_AGGREGATE.halstead.operators.identifiers],
      total: BASE_AGGREGATE.halstead.operators.total,
    },
    time: BASE_AGGREGATE.halstead.time,
    vocabulary: BASE_AGGREGATE.halstead.vocabulary,
    volume: BASE_AGGREGATE.halstead.volume,
  },
  paramCount: BASE_AGGREGATE.paramCount,
  sloc: {
    logical: BASE_AGGREGATE.sloc.logical,
    physical: BASE_AGGREGATE.sloc.physical,
  },
})

export class MaintainabilityTestContext {
  private readonly tempCleanups: Array<() => Promise<void>> = []

  public buildModuleReport(overrides: Partial<ModuleReport> = {}): ModuleReport {
    const aggregate = overrides.aggregate ?? cloneAggregate()

    return {
      aggregate,
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

  public async createTempDir(prefix: string = 'maintainability-'): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    this.tempCleanups.push(() => fs.rm(dir, { force: true, recursive: true }))
    return dir
  }

  public async reset(): Promise<void> {
    jest.restoreAllMocks()
    const cleanups = [...this.tempCleanups]
    this.tempCleanups.length = 0
    await Promise.all(cleanups.map(cleanup => cleanup()))
    process.exitCode = undefined
  }

  public async writeTempFile(root: string, relativePath: string, content: string): Promise<string> {
    const fullPath = path.join(root, relativePath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content, 'utf8')
    return fullPath
  }
}

export const createMaintainabilityTestContext = (): MaintainabilityTestContext => new MaintainabilityTestContext()
