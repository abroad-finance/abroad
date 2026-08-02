import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest'

import {
  completePartnerMfaChallenge,
  createPartnerApiKey,
  createPartnerPortalSession,
  createPartnerPortalSignup,
  createPartnerPortalSignupChallenge,
  exportPartnerTransactions,
  getPartnerPixReceipt,
  listPartnerTransactions,
  redeliverPartnerWebhook,
  resetPartnerPasswordWithRecoveryCode,
  stagePartnerWebhookUrl,
  verifyPartnerPortalSignupEmail,
} from '../services/partnerPortal/partnerPortalApi'
import {
  clearPartnerPortalSession,
  getPartnerPortalSession,
  setPartnerPortalSession,
} from '../services/partnerPortal/partnerPortalSessionStore'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  clearPartnerPortalSession()
})
afterAll(() => server.close())

describe('partner portal API', () => {
  it('exchanges normalized credentials without attaching a bearer token', async () => {
    server.use(http.post('https://api.abroad.finance/partner-portal/session', async ({ request }) => {
      expect(request.headers.get('content-type')).toBe('application/json')
      expect(request.headers.get('x-api-key')).toBeNull()
      expect(request.headers.get('authorization')).toBeNull()
      await expect(request.json()).resolves.toEqual({
        email: 'operator@decaf.so',
        password: 'secret portal password',
      })
      return HttpResponse.json({
        session: {
          accessToken: 'portal-token',
          email: 'operator@decaf.so',
          expiresAt: '2099-01-01T00:00:00.000Z',
          mfaEnabled: false,
          mfaVerified: false,
          partnerName: 'Decaf',
          role: 'ADMIN',
          userId: 'user-1',
        },
        status: 'AUTHENTICATED',
      })
    }))

    const session = await createPartnerPortalSession(
      '  Operator@Decaf.So  ',
      'secret portal password',
    )

    expect(session).toEqual(expect.objectContaining({ status: 'AUTHENTICATED' }))
  })

  it('uses unauthenticated challenge, idempotent signup, and verification contracts', async () => {
    server.use(
      http.post('https://api.abroad.finance/partner-portal/signup/challenge', ({ request }) => {
        expect(request.headers.get('authorization')).toBeNull()
        return HttpResponse.json({
          challengeToken: 'signed-challenge',
          expiresAt: '2026-08-02T15:15:00.000Z',
          readyAt: '2026-08-02T15:00:01.500Z',
        })
      }),
      http.post('https://api.abroad.finance/partner-portal/signup', async ({ request }) => {
        expect(request.headers.get('authorization')).toBeNull()
        expect(request.headers.get('idempotency-key')).toBe('signup-request-001')
        await expect(request.json()).resolves.toEqual({
          challengeToken: 'signed-challenge',
          company: 'Atlas Payments',
          contactWebsite: '',
          country: 'BR',
          email: 'admin@atlas.example',
          firstName: 'Ana',
          lastName: 'Silva',
          password: 'correct horse battery staple',
        })
        return HttpResponse.json({ status: 'VERIFICATION_REQUIRED' }, { status: 202 })
      }),
      http.post('https://api.abroad.finance/partner-portal/signup/email-verification', async ({ request }) => {
        expect(request.headers.get('authorization')).toBeNull()
        await expect(request.json()).resolves.toEqual({ token: 'verification-token' })
        return HttpResponse.json({
          accessToken: 'verified-session',
          email: 'admin@atlas.example',
          expiresAt: '2099-01-01T00:30:00.000Z',
          mfaEnabled: false,
          mfaVerified: false,
          partnerName: 'Atlas Payments',
          role: 'ADMIN',
          userId: 'user-1',
        })
      }),
    )

    await expect(createPartnerPortalSignupChallenge()).resolves.toEqual(
      expect.objectContaining({ challengeToken: 'signed-challenge' }),
    )
    await expect(createPartnerPortalSignup({
      challengeToken: 'signed-challenge',
      company: 'Atlas Payments',
      contactWebsite: '',
      country: 'BR',
      email: 'admin@atlas.example',
      firstName: 'Ana',
      lastName: 'Silva',
      password: 'correct horse battery staple',
    }, 'signup-request-001')).resolves.toEqual({ status: 'VERIFICATION_REQUIRED' })
    await expect(verifyPartnerPortalSignupEmail('verification-token')).resolves.toEqual(
      expect.objectContaining({ accessToken: 'verified-session' }),
    )
  })

  it('sends only the portal bearer token and complete filters', async () => {
    setPartnerPortalSession({
      accessToken: 'read-only-token',
      email: 'operator@decaf.so',
      expiresAt: '2099-01-01T00:00:00.000Z',
      mfaEnabled: true,
      mfaVerified: true,
      partnerName: 'Decaf',
      role: 'ADMIN',
      userId: 'user-1',
    })
    server.use(http.get('https://api.abroad.finance/partner-portal/transactions', ({ request }) => {
      const url = new URL(request.url)
      expect(request.headers.get('authorization')).toBe('Bearer read-only-token')
      expect(url.searchParams.get('query')).toBe('customer-1')
      expect(url.searchParams.get('status')).toBe('PAYMENT_COMPLETED')
      expect(url.searchParams.get('createdFrom')).toBe('2026-07-01')
      expect(url.searchParams.get('createdTo')).toBe('2026-07-31')
      expect(url.searchParams.get('page')).toBe('2')
      return HttpResponse.json({
        items: [], page: 2, pageSize: 20, statusCounts: [], total: 0,
      })
    }))

    const result = await listPartnerTransactions({
      createdFrom: '2026-07-01',
      createdTo: '2026-07-31',
      page: 2,
      pageSize: 20,
      query: 'customer-1',
      status: 'PAYMENT_COMPLETED',
    })

    expect(result.page).toBe(2)
  })

  it('returns CSV text and clears an unauthorized session', async () => {
    setPartnerPortalSession({
      accessToken: 'expired-remotely',
      email: 'operator@decaf.so',
      expiresAt: '2099-01-01T00:00:00.000Z',
      mfaEnabled: true,
      mfaVerified: true,
      partnerName: 'Decaf',
      role: 'ADMIN',
      userId: 'user-1',
    })
    server.use(
      http.get('https://api.abroad.finance/partner-portal/transactions/export.csv', () => (
        new HttpResponse('created_at,transaction_id\r\n', {
          headers: { 'Content-Type': 'text/csv' },
        })
      )),
      http.get('https://api.abroad.finance/partner-portal/transactions', () => (
        HttpResponse.json({ reason: 'Unauthorized' }, { status: 401 })
      )),
    )

    await expect(exportPartnerTransactions({})).resolves.toContain('transaction_id')
    await expect(listPartnerTransactions({})).rejects.toThrow('Unauthorized')
    expect(getPartnerPortalSession()).toBeNull()
  })

  it('keeps MFA and password-recovery proofs off authenticated requests', async () => {
    server.use(
      http.post('https://api.abroad.finance/partner-portal/session/mfa', async ({ request }) => {
        expect(request.headers.get('authorization')).toBeNull()
        await expect(request.json()).resolves.toEqual({
          challengeToken: 'challenge-token',
          code: '123456',
        })
        return HttpResponse.json({
          accessToken: 'verified-token',
          email: 'operator@decaf.so',
          expiresAt: '2099-01-01T00:30:00.000Z',
          mfaEnabled: true,
          mfaVerified: true,
          partnerName: 'Decaf',
          role: 'ADMIN',
          userId: 'user-1',
        })
      }),
      http.post('https://api.abroad.finance/partner-portal/session/password/recovery', async ({ request }) => {
        expect(request.headers.get('authorization')).toBeNull()
        await expect(request.json()).resolves.toEqual({
          email: 'operator@decaf.so',
          newPassword: 'a new secure password',
          recoveryCode: 'ABCD-EFGH-IJKL',
        })
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await expect(completePartnerMfaChallenge('challenge-token', '123456')).resolves.toEqual(
      expect.objectContaining({ mfaVerified: true }),
    )
    await expect(resetPartnerPasswordWithRecoveryCode({
      email: 'operator@decaf.so',
      newPassword: 'a new secure password',
      recoveryCode: 'ABCD-EFGH-IJKL',
    })).resolves.toBeUndefined()
  })

  it('uses the portal session for credential, webhook, receipt, and redelivery operations', async () => {
    setPartnerPortalSession({
      accessToken: 'admin-mfa-token',
      email: 'operator@decaf.so',
      expiresAt: '2099-01-01T00:00:00.000Z',
      mfaEnabled: true,
      mfaVerified: true,
      partnerName: 'Decaf',
      role: 'ADMIN',
      userId: 'user-1',
    })
    server.use(
      http.post('https://api.abroad.finance/partner-portal/integration/api-keys', async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer admin-mfa-token')
        await expect(request.json()).resolves.toEqual({
          name: 'Checkout',
          scopes: ['transactions:read'],
        })
        return HttpResponse.json({
          apiKey: { id: 'key-1', name: 'Checkout' },
          secret: 'abroad_secret_once',
        }, { status: 201 })
      }),
      http.put('https://api.abroad.finance/partner-portal/integration/webhook/draft', async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer admin-mfa-token')
        await expect(request.json()).resolves.toEqual({ url: 'https://partner.example/webhook' })
        return HttpResponse.json({
          active: {
            managedSecret: false, secretPrefix: null, url: null, version: 0,
          }, pending: null,
        })
      }),
      http.get('https://api.abroad.finance/partner-portal/transactions/transaction-1/receipt', ({ request }) => {
        expect(new URL(request.url).searchParams.get('lang')).toBe('pt-BR')
        return HttpResponse.json({
          contentBase64: 'JVBERg==', contentType: 'application/pdf', fileName: 'receipt.pdf', sizeBytes: 4,
        })
      }),
      http.post('https://api.abroad.finance/partner-portal/transactions/transaction-1/deliveries/delivery-1/redelivery', ({ request }) => {
        expect(request.headers.get('idempotency-key')).toBe('portal-redelivery-1')
        return HttpResponse.json({
          alreadyExisted: false, attempts: 1, deliveryId: 'redelivery-1', durationMs: 80, httpStatus: 204, status: 'DELIVERED',
        })
      }),
    )

    await expect(createPartnerApiKey({ name: 'Checkout', scopes: ['transactions:read'] })).resolves.toEqual(
      expect.objectContaining({ secret: 'abroad_secret_once' }),
    )
    await expect(stagePartnerWebhookUrl('https://partner.example/webhook')).resolves.toEqual(
      expect.objectContaining({ pending: null }),
    )
    await expect(getPartnerPixReceipt('transaction-1')).resolves.toEqual(
      expect.objectContaining({ fileName: 'receipt.pdf' }),
    )
    await expect(redeliverPartnerWebhook('transaction-1', 'delivery-1', 'portal-redelivery-1')).resolves.toEqual(
      expect.objectContaining({ status: 'DELIVERED' }),
    )
  })
})
