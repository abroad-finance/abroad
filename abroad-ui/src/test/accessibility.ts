import axe from 'axe-core'
import { expect } from 'vitest'

export const expectNoAccessibilityViolations = async (container: Element): Promise<void> => {
  const result = await axe.run(container, {
    rules: {
      // jsdom does not compute CSS colors, so contrast remains a manual/browser gate.
      'color-contrast': { enabled: false },
    },
  })
  expect(result.violations.map(violation => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.length,
  }))).toEqual([])
}
