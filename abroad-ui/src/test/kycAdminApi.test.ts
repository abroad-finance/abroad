import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'vitest'

import type { OpsMutationDetails } from '../services/admin/opsMutationTypes'

import {
  assignKycReviewer,
  getKycSubmission,
  getTransactionKycLink,
  listKycReviewers,
  listKycSubmissions,
} from '../services/admin/kycAdminApi'
import { clearOpsApiKey, setOpsApiKey } from '../services/admin/opsAuthStore'

const baseUrl = 'https://api.abroad.finance'
const server = setupServer()
const mutation: OpsMutationDetails = {
  confirmation: 'ASSIGN KYC REVIEW',
  expectedVersion: 3,
  idempotencyKey: 'd2856a20-8953-4b12-ad30-1107837ca9ef',
  reason: 'Balance the compliance review queue',
  reference: 'KYC-82',
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  clearOpsApiKey()
  server.resetHandlers()
})
afterAll(() => server.close())

describe('kycAdminApi', () => {
  test('encodes the complete shareable review-queue filter contract', async () => {
    setOpsApiKey('ops_test_key')
    server.use(http.get(`${baseUrl}/ops/kyc`, ({ request }) => {
      expect(Object.fromEntries(new URL(request.url).searchParams)).toEqual({
        ageHoursGte: '48',
        createdFrom: '2026-08-01T00:00:00.000Z',
        createdTo: '2026-08-02T00:00:00.000Z',
        documentType: 'PASSPORT',
        kycId: '11111111-1111-4111-8111-111111111111',
        nationality: 'BR',
        page: '2',
        pageSize: '20',
        partnerId: '22222222-2222-4222-8222-222222222222',
        query: 'Ada',
        reviewer: 'UNASSIGNED',
        status: 'PENDING_APPROVAL',
      })
      return HttpResponse.json({
        items: [], page: 2, pageSize: 20, total: 0,
      })
    }))

    const result = await listKycSubmissions({
      ageHoursGte: 48,
      createdFrom: '2026-08-01T00:00:00.000Z',
      createdTo: '2026-08-02T00:00:00.000Z',
      documentType: 'PASSPORT',
      kycId: '11111111-1111-4111-8111-111111111111',
      nationality: 'BR',
      page: 2,
      pageSize: 20,
      partnerId: '22222222-2222-4222-8222-222222222222',
      query: 'Ada',
      reviewer: 'UNASSIGNED',
      status: 'PENDING_APPROVAL',
    })

    expect(result.page).toBe(2)
  })

  test('separates reviewer options and deliberate detail reads', async () => {
    setOpsApiKey('ops_test_key')
    server.use(
      http.get(`${baseUrl}/ops/kyc/reviewer-options`, () => HttpResponse.json({
        items: [{ displayName: 'Compliance Operator', id: 'reviewer-1', role: 'COMPLIANCE' }],
      })),
      http.get(`${baseUrl}/ops/kyc/11111111-1111-4111-8111-111111111111`, () => HttpResponse.json({
        fullName: 'Ada Lovelace',
        id: '11111111-1111-4111-8111-111111111111',
      })),
    )

    const reviewers = await listKycReviewers()
    const detail = await getKycSubmission('11111111-1111-4111-8111-111111111111')

    expect(reviewers[0]?.displayName).toBe('Compliance Operator')
    expect(detail.fullName).toBe('Ada Lovelace')
  })

  test('reads the transaction identity linkage from its own masked endpoint', async () => {
    setOpsApiKey('ops_test_key')
    server.use(http.get(
      `${baseUrl}/ops/kyc/by-transaction/44444444-4444-4444-8444-444444444444`,
      () => HttpResponse.json({
        effectiveSubmissionId: '11111111-1111-4111-8111-111111111111',
        partnerUser: {
          disabledAt: null,
          id: '33333333-3333-4333-8333-333333333333',
          partnerId: '22222222-2222-4222-8222-222222222222',
          partnerName: 'Acme Partner',
          userId: 'external-user-1',
        },
        submissions: [{ fullNameMasked: 'A•• L••', id: '11111111-1111-4111-8111-111111111111' }],
        transactionId: '44444444-4444-4444-8444-444444444444',
      }),
    ))

    const link = await getTransactionKycLink('44444444-4444-4444-8444-444444444444')

    expect(link.effectiveSubmissionId).toBe('11111111-1111-4111-8111-111111111111')
    expect(link.submissions[0]?.fullNameMasked).toBe('A•• L••')
  })

  test('sends assignment reason, idempotency, confirmation, and version evidence', async () => {
    setOpsApiKey('ops_test_key')
    server.use(http.post(`${baseUrl}/ops/kyc/11111111-1111-4111-8111-111111111111/assign`, async ({ request }) => {
      expect(request.headers.get('if-match')).toBe('"3"')
      expect(request.headers.get('x-ops-confirmation')).toBe('ASSIGN KYC REVIEW')
      expect(request.headers.get('x-ops-idempotency-key')).toBe(mutation.idempotencyKey)
      expect(request.headers.get('x-ops-reason')).toBe(mutation.reason)
      expect(request.headers.get('x-ops-reference')).toBe(mutation.reference)
      expect(await request.json()).toEqual({ reviewerUserId: 'reviewer-1' })
      return HttpResponse.json({
        id: '11111111-1111-4111-8111-111111111111',
        reviewer: { displayName: 'Compliance Operator', id: 'reviewer-1', role: 'COMPLIANCE' },
        version: 4,
      })
    }))

    const result = await assignKycReviewer(
      '11111111-1111-4111-8111-111111111111',
      'reviewer-1',
      mutation,
    )

    expect(result.version).toBe(4)
  })
})
