declare module 'typhonjs-escomplex' {
  import type { ParserOptions } from '@babel/parser'

  export interface HalsteadIdentifiers {
    distinct: number
    identifiers: string[]
    total: number
  }

  export interface HalsteadMetrics {
    bugs: number
    difficulty: number
    effort: number
    length: number
    operands: HalsteadIdentifiers
    operators: HalsteadIdentifiers
    time: number
    vocabulary: number
    volume: number
  }

  export interface SourceLinesOfCode {
    logical: number
    physical: number
  }

  export interface AggregateMetrics {
    aggregate?: unknown
    cyclomatic: number
    cyclomaticDensity: number
    halstead: HalsteadMetrics
    paramCount: number
    sloc: SourceLinesOfCode
  }

  export interface ModuleReport {
    aggregate: AggregateMetrics
    aggregateAverage?: unknown
    classes: unknown[]
    dependencies: unknown[]
    errors: unknown[]
    filePath?: string
    lineEnd: number
    lineStart: number
    maintainability: number
    methodAverage?: unknown
    methods: unknown[]
    settings?: Record<string, unknown>
    srcPath?: string
    srcPathAlias?: string
  }

  export interface ProjectReport {
    adjacencyList?: Record<string, number[]>
    changeCost?: number
    coreSize?: number
    errors?: unknown[]
    firstOrderDensity?: number
    moduleAverage?: unknown
    modules: ModuleReport[]
    settings: Record<string, unknown>
    visibilityList?: Record<string, number[]>
  }

  export interface ProjectSourceInput {
    code: string
    filePath?: string
    srcPath: string
    srcPathAlias?: string
  }

  export interface AnalyzeOptions {
    ignoreErrors?: boolean
    logicalor?: boolean
    newmi?: boolean
    noCoreSize?: boolean
    skipCalculation?: boolean
  }

  export interface ESComplex {
    analyzeModule(
      source: string,
      options?: AnalyzeOptions,
      parserOptions?: ParserOptions,
      parserOverride?: unknown,
    ): ModuleReport
    analyzeModuleAST(ast: unknown, options?: AnalyzeOptions): ModuleReport
    analyzeModuleASTAsync(ast: unknown, options?: AnalyzeOptions): Promise<ModuleReport>
    analyzeModuleAsync(
      source: string,
      options?: AnalyzeOptions,
      parserOptions?: ParserOptions,
      parserOverride?: unknown,
    ): Promise<ModuleReport>
    analyzeProject(
      sources: ProjectSourceInput[],
      options?: AnalyzeOptions,
      parserOptions?: ParserOptions,
      parserOverride?: unknown,
    ): ProjectReport
    analyzeProjectAST(modules: unknown[], options?: AnalyzeOptions): ProjectReport
    analyzeProjectASTAsync(modules: unknown[], options?: AnalyzeOptions): Promise<ProjectReport>
    analyzeProjectAsync(
      sources: ProjectSourceInput[],
      options?: AnalyzeOptions,
      parserOptions?: ParserOptions,
      parserOverride?: unknown,
    ): Promise<ProjectReport>
    parse(source: string, parserOptions?: ParserOptions, parserOverride?: unknown): unknown
    parseAsync(source: string, parserOptions?: ParserOptions, parserOverride?: unknown): Promise<unknown>
    processProject(results: ProjectReport, options?: AnalyzeOptions): ProjectReport
    processProjectAsync(results: ProjectReport, options?: AnalyzeOptions): Promise<ProjectReport>
  }

  const escomplex: ESComplex
  export default escomplex
}
