import { z } from 'zod'

import { FlowStepRuntimeContext } from './flowTypes'

const contextFieldSchema = z.enum(['sourceAmount', 'targetAmount'])

export const amountSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    field: contextFieldSchema,
    kind: z.literal('context'),
  }),
  z.object({
    field: z.string().min(1),
    kind: z.literal('step'),
    stepOrder: z.number().int().positive(),
  }),
])

export type AmountSource = z.infer<typeof amountSourceSchema>

export function resolveAmount(
  runtime: FlowStepRuntimeContext,
  source: AmountSource | undefined,
  fallback: number,
): number {
  if (!source) {
    return fallback
  }

  if (source.kind === 'context') {
    return runtime.context[source.field]
  }

  const output = runtime.stepOutputs.get(source.stepOrder)
  if (!output || !(source.field in output)) {
    throw new Error(`Step ${source.stepOrder} output is missing field ${source.field}`)
  }
  const raw = output[source.field]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`Step ${source.stepOrder} output field ${source.field} must be a finite number`)
  }
  return raw
}
