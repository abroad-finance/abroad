import { classifyOpsFailure } from '../../../../modules/transactions/application/OpsFailureClassifier'

describe('classifyOpsFailure', () => {
  it.each([
    ['insufficient_liquidity', 'LIQUIDITY'],
    ['provider returned HTTP 429', 'RATE_LIMIT'],
    ['invalid_pix_key', 'DESTINATION'],
    ['provider request timed out', 'PROVIDER_UNAVAILABLE'],
    ['webhook delivery_failed', 'WEBHOOK'],
    ['refund attempt failed', 'REFUND'],
  ] as const)('maps %s to the stable %s category', (evidence, category) => {
    expect(classifyOpsFailure([evidence])).toEqual(expect.objectContaining({ category }))
  })

  it('returns safe guidance without echoing raw provider evidence', () => {
    const raw = 'timeout customer-private-payload'
    const result = classifyOpsFailure([{ nested: { reason: raw } }])

    expect(result.category).toBe('PROVIDER_UNAVAILABLE')
    expect(JSON.stringify(result)).not.toContain('customer-private-payload')
    expect(result.ambiguityWarning).toMatch(/accepted work/i)
  })
})
