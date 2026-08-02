import type { Request } from 'express'

import { OPS_MUTATION_HEADERS, OpsMutationEnvelope } from '../../application/opsMutation'

const readExpectedVersion = (request: Request): number | undefined => {
  const raw = request.header(OPS_MUTATION_HEADERS.expectedVersion)?.trim()
  if (!raw) return undefined
  const unquoted = raw.replace(/^W\//, '').replace(/^"|"$/g, '')
  const parsed = Number(unquoted)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

export const readOpsMutationEnvelope = (request: Request): OpsMutationEnvelope => ({
  confirmation: request.header(OPS_MUTATION_HEADERS.confirmation) ?? '',
  expectedVersion: readExpectedVersion(request),
  idempotencyKey: request.header(OPS_MUTATION_HEADERS.idempotencyKey) ?? '',
  reason: request.header(OPS_MUTATION_HEADERS.reason) ?? '',
  reference: request.header(OPS_MUTATION_HEADERS.reference) || undefined,
})
