import fs from 'node:fs/promises'
import path from 'node:path'

import * as maintainabilityReport from '../../../scripts/maintainability-report'
import { createMaintainabilityTestContext } from './maintainabilityReportTestUtils'

const context = createMaintainabilityTestContext()

afterEach(async () => {
  await context.reset()
})

describe('file discovery and loading', () => {
  it('collects supported TypeScript sources while respecting ignore rules and symlinks', async () => {
    const root = await context.createTempDir('maintainability-files-')
    const included = await context.writeTempFile(root, 'main.ts', 'export const answer = 42;')
    await context.writeTempFile(root, 'ignored/file.ts', 'export const ignored = true;')
    await context.writeTempFile(root, 'types.d.ts', 'export interface IgnoreMe {}')
    await context.writeTempFile(root, 'script.js', 'console.log("noop")')
    const symlinkTarget = await context.writeTempFile(root, 'linked.ts', 'export const linked = true;')
    await fs.symlink(symlinkTarget, path.join(root, 'alias.ts'))

    const matcher = maintainabilityReport.buildIgnoreMatcher(['ignored'])
    const files = await maintainabilityReport.collectSourceFiles(root, matcher)

    expect(files.sort()).toEqual([included, symlinkTarget].sort())
  })

  it('loads sources and reports diagnostics with relative paths', async () => {
    const root = await context.createTempDir('maintainability-load-')
    const validFile = await context.writeTempFile(root, 'good.ts', 'export const value: number = 1;')
    const invalidFile = await context.writeTempFile(root, 'bad.ts', 'export const broken =')

    const { diagnostics, sources } = await maintainabilityReport.loadSources([validFile, invalidFile], root)

    expect(sources).toHaveLength(2)
    expect(sources[0].srcPath).toBe('good.ts')
    expect(sources[1].srcPath).toBe('bad.ts')
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]).toContain('bad.ts')
  })

  it('checks directory candidates before analysis', async () => {
    const root = await context.createTempDir('maintainability-assert-')
    const filePath = await context.writeTempFile(root, 'file.txt', 'content')
    await expect(maintainabilityReport.assertDirectory(root)).resolves.toBeUndefined()
    await expect(maintainabilityReport.assertDirectory(filePath)).rejects.toThrow(
      `Expected ${filePath} to be a directory`,
    )
  })
})
