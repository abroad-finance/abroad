import type { Request } from 'express'

import { readOpsMutationEnvelope } from '../../../../../modules/operations/interfaces/http/opsMutationHeaders'

const buildRequest = (headers: Readonly<Record<string, string>>): Request => ({
  header: jest.fn((name: string) => headers[name.toLowerCase()]),
} as unknown as Request)

describe('readOpsMutationEnvelope', () => {
  it('maps the central mutation headers and a quoted If-Match version', () => {
    const request = buildRequest({
      'if-match': '"7"',
      'x-ops-confirmation': 'UPDATE FLOW',
      'x-ops-idempotency-key': 'e5083f1f-3500-4888-b9c3-5d9bd38b6749',
      'x-ops-reason': 'Approved configuration change for incident INC-42',
      'x-ops-reference': 'INC-42',
    })

    expect(readOpsMutationEnvelope(request)).toEqual({
      confirmation: 'UPDATE FLOW',
      expectedVersion: 7,
      idempotencyKey: 'e5083f1f-3500-4888-b9c3-5d9bd38b6749',
      reason: 'Approved configuration change for incident INC-42',
      reference: 'INC-42',
    })
  })

  it('leaves absent and malformed values for policy validation', () => {
    const request = buildRequest({ 'if-match': 'not-a-version' })

    expect(readOpsMutationEnvelope(request)).toEqual({
      confirmation: '',
      expectedVersion: undefined,
      idempotencyKey: '',
      reason: '',
      reference: undefined,
    })
  })
})
