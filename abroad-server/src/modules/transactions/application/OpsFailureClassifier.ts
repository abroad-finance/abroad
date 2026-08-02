import type { Prisma } from '@prisma/client'

export type OpsFailureCategory
  = | 'DESTINATION'
    | 'FLOW_EXECUTION'
    | 'LIQUIDITY'
    | 'NETWORK'
    | 'PRICING'
    | 'PROVIDER_REJECTED'
    | 'PROVIDER_UNAVAILABLE'
    | 'RATE_LIMIT'
    | 'REFUND'
    | 'UNKNOWN'
    | 'WEBHOOK'

export type OpsFailureGuidance = {
  ambiguityWarning: null | string
  category: OpsFailureCategory
  label: string
  recommendedAction: string
}

type Rule = OpsFailureGuidance & {
  patterns: readonly RegExp[]
}

const rules: readonly Rule[] = [
  {
    ambiguityWarning: null,
    category: 'PRICING',
    label: 'Pricing or quote unavailable',
    patterns: [/pricing/i, /price[_\s-]?(unavailable|expired|invalid)/i, /exchange[_\s-]?rate/i, /quote[_\s-]?(failed|unavailable)/i],
    recommendedAction: 'Check the pricing provider and corridor coverage before requesting another quote or retry.',
  },
  {
    ambiguityWarning: null,
    category: 'LIQUIDITY',
    label: 'Insufficient provider liquidity',
    patterns: [/liquidity/i, /insufficient[_\s-]?(balance|funds)/i, /balance[_\s-]?unavailable/i],
    recommendedAction: 'Check the provider balance posture and active liquidity incident before retrying.',
  },
  {
    ambiguityWarning: null,
    category: 'RATE_LIMIT',
    label: 'Provider rate limit',
    patterns: [/rate[_\s-]?limit/i, /too many requests/i, /\b429\b/],
    recommendedAction: 'Check provider throttling and queued retries; avoid a manual replay while work is already scheduled.',
  },
  {
    ambiguityWarning: null,
    category: 'DESTINATION',
    label: 'Destination rejected',
    patterns: [/invalid[_\s-]?(destination|account|pix)/i, /pix[_\s-]?key/i, /account[_\s-]?number/i, /tax[_\s-]?id/i],
    recommendedAction: 'Verify the partner-supplied destination semantics without copying recipient data into notes.',
  },
  {
    ambiguityWarning: 'The provider may have accepted work before the local timeout. Verify provider state before any replay.',
    category: 'PROVIDER_UNAVAILABLE',
    label: 'Provider unavailable or timed out',
    patterns: [/timeout/i, /timed out/i, /unavailable/i, /gateway/i, /econn/i, /network error/i],
    recommendedAction: 'Inspect the provider and flow timeline, then confirm whether the request was accepted before retrying.',
  },
  {
    ambiguityWarning: null,
    category: 'PROVIDER_REJECTED',
    label: 'Provider rejected payout',
    patterns: [/provider[_\s-]?(failed|rejected)/i, /payout[_\s-]?(failed|rejected)/i, /withdrawal[_\s-]?(failed|rejected)/i, /schema[_\s-]?mismatch/i],
    recommendedAction: 'Review the normalized provider event and payout identifiers, then follow the provider incident runbook.',
  },
  {
    ambiguityWarning: null,
    category: 'WEBHOOK',
    label: 'Partner webhook delivery failed',
    patterns: [/webhook/i, /delivery[_\s-]?failed/i],
    recommendedAction: 'Confirm the partner endpoint is healthy and whether a bounded redelivery is already queued.',
  },
  {
    ambiguityWarning: 'A refund may be processing on-chain even when local confirmation is delayed.',
    category: 'REFUND',
    label: 'Refund incomplete',
    patterns: [/refund/i],
    recommendedAction: 'Verify the refund timeline and on-chain identifier before requesting another intervention.',
  },
  {
    ambiguityWarning: null,
    category: 'NETWORK',
    label: 'Blockchain or settlement network issue',
    patterns: [/blockchain/i, /stellar/i, /solana/i, /celo/i, /polygon/i, /on[_\s-]?chain/i],
    recommendedAction: 'Check chain receipt and listener state, then use reconciliation only when the evidence is complete.',
  },
  {
    ambiguityWarning: null,
    category: 'FLOW_EXECUTION',
    label: 'Execution flow failed',
    patterns: [/flow/i, /step/i, /orchestrat/i, /max[_\s-]?attempt/i],
    recommendedAction: 'Open the linked flow, identify the first failed step, and verify idempotency before recovery.',
  },
] as const

const UNKNOWN_GUIDANCE: OpsFailureGuidance = {
  ambiguityWarning: 'The available evidence is not specific enough to prove where execution stopped.',
  category: 'UNKNOWN',
  label: 'Unclassified execution issue',
  recommendedAction: 'Review the chronological evidence and provider identifiers before choosing a recovery action.',
}

const collectText = (
  value: null | Prisma.JsonValue | string | undefined,
  depth = 0,
): string[] => {
  if (depth > 3 || value === null || value === undefined) return []
  if (typeof value === 'string') return [value.slice(0, 500)]
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) {
    return value.slice(0, 20).flatMap(item => collectText(item, depth + 1))
  }
  return Object.entries(value)
    .slice(0, 30)
    .flatMap(([key, nested]) => [key, ...collectText(nested, depth + 1)])
}

export const classifyOpsFailure = (
  evidence: readonly (null | Prisma.JsonValue | string | undefined)[],
): OpsFailureGuidance => {
  const searchable = evidence.flatMap(value => collectText(value)).join(' ').slice(0, 8_000)
  for (const rule of rules) {
    if (rule.patterns.some(pattern => pattern.test(searchable))) {
      return {
        ambiguityWarning: rule.ambiguityWarning,
        category: rule.category,
        label: rule.label,
        recommendedAction: rule.recommendedAction,
      }
    }
  }
  return UNKNOWN_GUIDANCE
}
