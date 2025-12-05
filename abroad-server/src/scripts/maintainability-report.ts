import { Command, Option } from 'commander'
import fs from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import escomplex, { AnalyzeOptions, ModuleReport, ProjectSourceInput } from 'typhonjs-escomplex'

interface CliOptions {
  failOnError: boolean
  format: OutputFormat
  ignoredPaths: string[]
  outputPath?: string
  sourceRoot: string
}

interface MaintainabilityReport {
  averageNormalizedMaintainability: number
  ignoredPaths: string[]
  rows: MaintainabilityRow[]
}

interface MaintainabilityRow {
  cyclomaticComplexity: number
  halsteadVolume: number
  logicalSloc: number
  maintainabilityIndex: number
  normalizedMaintainability: number
  path: string
  physicalSloc: number
}

type OutputFormat = 'json' | 'table'

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx'])
const DECLARATION_SUFFIX = '.d.ts'
const MAINTAINABILITY_MAX = 171
const DECORATOR_OVERRIDE = { decoratorsLegacy: true }
const DEFAULT_IGNORED_PATHS = ['routes.ts']
const TRANSPILE_OPTIONS: ts.CompilerOptions = {
  experimentalDecorators: true,
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2020,
}

const decimalFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
})

type PathIgnorePredicate = (normalizedRelativePath: string) => boolean

async function assertDirectory(candidate: string) {
  const stats = await fs.stat(candidate)
  if (!stats.isDirectory()) {
    throw new Error(`Expected ${candidate} to be a directory`)
  }
}

function buildAnalysisOptions(cliOptions: CliOptions): AnalyzeOptions {
  return {
    ignoreErrors: !cliOptions.failOnError,
  }
}

function buildIgnoreMatcher(ignoredPaths: string[]): PathIgnorePredicate {
  if (ignoredPaths.length === 0) {
    return () => false
  }

  const ignoredPathSet = new Set(ignoredPaths)

  return (relativePath: string) =>
    ignoredPathSet.has(relativePath) || ignoredPaths.some(ignored => relativePath.startsWith(`${ignored}/`))
}

function buildMaintainabilityRows(modules: ModuleReport[]): MaintainabilityRow[] {
  return modules.map((moduleReport) => {
    const aggregate = moduleReport.aggregate
    const normalizedMaintainability = normalizeMaintainability(moduleReport.maintainability)

    return {
      cyclomaticComplexity: aggregate.cyclomatic,
      halsteadVolume: aggregate.halstead.volume,
      logicalSloc: aggregate.sloc.logical,
      maintainabilityIndex: moduleReport.maintainability,
      normalizedMaintainability,
      path: moduleReport.srcPath ?? moduleReport.filePath ?? '<unknown>',
      physicalSloc: aggregate.sloc.physical,
    }
  })
}

function buildTable(report: MaintainabilityReport): string {
  const headers = ['File', 'MI (%)', 'Cyclomatic', 'Halstead V', 'SLOC (L/P)']
  const dataRows = report.rows.map(row => [
    row.path,
    `${decimalFormatter.format(row.normalizedMaintainability)}%`,
    decimalFormatter.format(row.cyclomaticComplexity),
    decimalFormatter.format(row.halsteadVolume),
    `${row.logicalSloc}/${row.physicalSloc}`,
  ])

  const columnWidths = headers.map((header, index) => {
    const maxDataWidth = Math.max(...dataRows.map(dataRow => String(dataRow[index]).length))
    return Math.max(header.length, maxDataWidth)
  })

  const headerLine = headers.map((header, index) => header.padEnd(columnWidths[index])).join('  ')
  const separatorLine = columnWidths.map(width => '-'.repeat(width)).join('  ')
  const dataLines = dataRows.map(dataRow =>
    dataRow.map((cell, index) => String(cell).padEnd(columnWidths[index])).join('  '),
  )

  return [
    `Maintainability report for ${report.rows.length} file${report.rows.length === 1 ? '' : 's'}`,
    headerLine,
    separatorLine,
    ...dataLines,
    '',
    `Combined average MI (%): ${decimalFormatter.format(report.averageNormalizedMaintainability)}%`,
    ...(report.ignoredPaths.length > 0 ? [`Ignored paths: ${report.ignoredPaths.join(', ')}`] : []),
  ].join('\n')
}

function calculateAverageNormalizedMaintainability(rows: MaintainabilityRow[]): number {
  if (rows.length === 0) {
    return 0
  }

  const totalNormalizedMaintainability = rows.reduce(
    (total, row) => total + row.normalizedMaintainability,
    0,
  )

  return totalNormalizedMaintainability / rows.length
}

function collectModuleErrors(modules: ModuleReport[]): string[] {
  const errors: string[] = []

  for (const moduleReport of modules) {
    if (!moduleReport.errors || moduleReport.errors.length === 0) {
      continue
    }

    const location = moduleReport.srcPath ?? moduleReport.filePath ?? '<unknown>'
    for (const issue of moduleReport.errors) {
      errors.push(`${location}: ${extractErrorMessage(issue)}`)
    }
  }

  return errors
}

async function collectSourceFiles(root: string, shouldIgnore: PathIgnorePredicate): Promise<string[]> {
  return collectSourceFilesFromDirectory(root, root, shouldIgnore)
}

async function collectSourceFilesFromDirectory(
  directory: string,
  root: string,
  shouldIgnore: PathIgnorePredicate,
): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    const normalizedRelativePath = toNormalizedRelativePath(root, absolutePath)

    if (entry.isSymbolicLink()) {
      continue
    }

    if (shouldIgnore(normalizedRelativePath)) {
      continue
    }

    if (entry.isDirectory()) {
      const nestedFiles = await collectSourceFilesFromDirectory(absolutePath, root, shouldIgnore)
      files.push(...nestedFiles)
      continue
    }

    if (!isSupportedSource(entry.name)) {
      continue
    }

    files.push(absolutePath)
  }

  return files
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return JSON.stringify(error)
}

function formatDiagnostics(filePath: string, diagnostics: readonly ts.Diagnostic[]): string[] {
  return diagnostics.map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')

    if (diagnostic.file && typeof diagnostic.start === 'number') {
      const { character, line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      return `${diagnostic.file.fileName}:${line + 1}:${character + 1} ${message}`
    }

    return `${filePath}: ${message}`
  })
}

function isSupportedSource(filename: string): boolean {
  if (filename.endsWith(DECLARATION_SUFFIX)) {
    return false
  }

  const extension = path.extname(filename).toLowerCase()
  return SUPPORTED_EXTENSIONS.has(extension)
}

async function loadSources(
  files: string[],
  root: string,
): Promise<{ diagnostics: string[], sources: ProjectSourceInput[] }> {
  const diagnostics: string[] = []
  const sources: ProjectSourceInput[] = []

  for (const filePath of files) {
    const code = await fs.readFile(filePath, 'utf8')
    const relativePath = toNormalizedRelativePath(root, filePath)
    const { diagnostics: transpileDiagnostics, outputText } = ts.transpileModule(code, {
      compilerOptions: TRANSPILE_OPTIONS,
      fileName: relativePath,
      reportDiagnostics: true,
    })

    if (transpileDiagnostics && transpileDiagnostics.length > 0) {
      diagnostics.push(...formatDiagnostics(relativePath, transpileDiagnostics))
    }

    sources.push({
      code: outputText,
      filePath,
      srcPath: relativePath,
    })
  }

  return { diagnostics, sources }
}

function normalizeIgnorePath(pathCandidate: string, root: string): string {
  const trimmedCandidate = pathCandidate.replace(/[/\\]+$/, '')
  if (trimmedCandidate.length === 0) {
    throw new Error('Ignore path must not be empty')
  }

  const candidateWithinRoot = stripLeadingRootSegment(trimmedCandidate, root)
  const resolvedCandidate = path.isAbsolute(candidateWithinRoot)
    ? path.normalize(candidateWithinRoot)
    : path.resolve(root, candidateWithinRoot)
  const relativePath = path.relative(root, resolvedCandidate)

  if (relativePath === '' || relativePath === '.') {
    throw new Error('Ignoring the source root is not supported')
  }

  if (relativePath.startsWith('..')) {
    throw new Error(`Ignore path ${trimmedCandidate} is outside of the source root ${root}`)
  }

  return relativePath.split(path.sep).join('/')
}

function normalizeIgnorePaths(ignoredPaths: string[], root: string): string[] {
  const sanitizedPaths = ignoredPaths
    .map(pathCandidate => pathCandidate.trim())
    .filter(pathCandidate => pathCandidate.length > 0)

  const normalizedPaths = sanitizedPaths.map(pathCandidate => normalizeIgnorePath(pathCandidate, root))
  return Array.from(new Set(normalizedPaths))
}

function normalizeMaintainability(maintainability: number): number {
  const clamped = Math.min(MAINTAINABILITY_MAX, Math.max(0, maintainability))
  return (clamped / MAINTAINABILITY_MAX) * 100
}

function parseCliOptions(): CliOptions {
  const program = new Command()
  const formatOption = new Option('-f, --format <type>', 'Output format').choices(['table', 'json']).default('table')

  program
    .name('maintainability-report')
    .description('Generate maintainability index metrics per file in the src directory')
    .addOption(formatOption)
    .option(
      '-i, --ignore <paths...>',
      'Paths relative to --src to ignore (files or directories). Can be provided multiple times.',
    )
    .option('-s, --src <path>', 'Source directory to analyze', path.resolve(process.cwd(), 'src'))
    .option('-o, --output <file>', 'Write the JSON report to a file in addition to console output')
    .option('--ignore-errors', 'Do not fail when parser or analysis errors are found', false)

  const options = program.parse(process.argv).opts<{
    format: OutputFormat
    ignore?: string[]
    ignoreErrors?: boolean
    output?: string
    src: string
  }>()

  const sourceRoot = path.resolve(options.src)
  const ignoredPaths = normalizeIgnorePaths(
    [...DEFAULT_IGNORED_PATHS, ...(options.ignore ?? [])],
    sourceRoot,
  )

  return {
    failOnError: !options.ignoreErrors,
    format: options.format,
    ignoredPaths,
    outputPath: options.output ? path.resolve(options.output) : undefined,
    sourceRoot,
  }
}

async function persistReport(report: MaintainabilityReport, outputPath: string) {
  const outputDir = path.dirname(outputPath)
  await fs.mkdir(outputDir, { recursive: true })
  const payload = JSON.stringify(report, null, 2)
  await fs.writeFile(outputPath, payload, 'utf8')
}

function renderReport(report: MaintainabilityReport, cliOptions: CliOptions) {
  if (cliOptions.format === 'json') {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const table = buildTable(report)

  console.log(table)

  if (cliOptions.outputPath) {
    console.log(`\nJSON report written to ${cliOptions.outputPath}`)
  }
}

async function run() {
  try {
    const cliOptions = parseCliOptions()
    await assertDirectory(cliOptions.sourceRoot)

    const ignoreMatcher = buildIgnoreMatcher(cliOptions.ignoredPaths)
    const sourceFiles = await collectSourceFiles(cliOptions.sourceRoot, ignoreMatcher)
    if (sourceFiles.length === 0) {
      throw new Error(`No TypeScript sources found under ${cliOptions.sourceRoot} after applying ignore filters`)
    }

    const { diagnostics, sources } = await loadSources(sourceFiles, cliOptions.sourceRoot)
    if (diagnostics.length > 0) {
      console.warn('Transpilation warnings:\n', diagnostics.join('\n'))
    }
    const projectReport = escomplex.analyzeProject(
      sources,
      buildAnalysisOptions(cliOptions),
      undefined,
      DECORATOR_OVERRIDE,
    )

    const moduleErrors = collectModuleErrors(projectReport.modules)
    if (moduleErrors.length > 0 && cliOptions.failOnError) {
      const details = moduleErrors.map(error => `- ${error}`).join('\n')
      throw new Error(`Complexity analysis reported errors:\n${details}`)
    }

    const rows = buildMaintainabilityRows(projectReport.modules)
    const sortedRows = sortRows(rows)
    const averageNormalizedMaintainability = calculateAverageNormalizedMaintainability(sortedRows)
    const report: MaintainabilityReport = {
      averageNormalizedMaintainability,
      ignoredPaths: cliOptions.ignoredPaths,
      rows: sortedRows,
    }

    if (cliOptions.outputPath) {
      await persistReport(report, cliOptions.outputPath)
    }

    renderReport(report, cliOptions)
  }
  catch (error: unknown) {
    console.error(`Failed to generate maintainability report: ${extractErrorMessage(error)}`)
    process.exitCode = 1
  }
}

function sortRows(rows: MaintainabilityRow[]): MaintainabilityRow[] {
  return [...rows].sort((left, right) => left.maintainabilityIndex - right.maintainabilityIndex)
}

function stripLeadingRootSegment(pathCandidate: string, root: string): string {
  if (path.isAbsolute(pathCandidate)) {
    return pathCandidate
  }

  const candidateWithoutCurrentDirPrefix = pathCandidate.startsWith('./')
    ? pathCandidate.slice(2)
    : pathCandidate
  const rootBasename = path.basename(root)

  if (candidateWithoutCurrentDirPrefix === rootBasename) {
    return '.'
  }

  if (
    candidateWithoutCurrentDirPrefix.startsWith(`${rootBasename}/`)
    || candidateWithoutCurrentDirPrefix.startsWith(`${rootBasename}\\`)
  ) {
    return candidateWithoutCurrentDirPrefix.slice(rootBasename.length + 1)
  }

  return candidateWithoutCurrentDirPrefix
}

function toNormalizedRelativePath(root: string, filePath: string): string {
  const relativePath = path.relative(root, filePath) || path.basename(filePath)
  return relativePath.split(path.sep).join('/')
}

void run()
