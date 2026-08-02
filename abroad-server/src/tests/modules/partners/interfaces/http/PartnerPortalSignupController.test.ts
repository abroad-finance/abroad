import 'reflect-metadata'

import type { Request as ExpressRequest } from 'express'
import type { TsoaResponse } from 'tsoa'

import { PartnerPortalRole } from '@prisma/client'

import { PartnerPortalSignupRateLimitError } from '../../../../../modules/partners/application/PartnerPortalSignupProtectionService'
import { PartnerPortalEmailVerificationError, PartnerPortalSignupService } from '../../../../../modules/partners/application/PartnerPortalSignupService'
import { PartnerPortalSignupController } from '../../../../../modules/partners/interfaces/http/PartnerPortalSignupController'

type SignupServiceMock = Pick<
  PartnerPortalSignupService,
  'createChallenge' | 'signup' | 'verifyEmail'
>

const request = {
  header: jest.fn((name: string) => (
    name === 'x-forwarded-for' ? '198.51.100.99, 203.0.113.10, 35.191.0.1' : undefined
  )),
  socket: { remoteAddress: '127.0.0.1' },
} as unknown as ExpressRequest

const badRequestResponder = (): TsoaResponse<400, { reason: string }> => (
  jest.fn((_status: 400, payload: { reason: string }) => payload)
)

const tooManyRequestsResponder = (): TsoaResponse<429, { reason: string }> => (
  jest.fn((_status: 429, payload: { reason: string }) => payload)
)

const buildService = (): jest.Mocked<SignupServiceMock> => ({
  createChallenge: jest.fn<
    ReturnType<PartnerPortalSignupService['createChallenge']>,
    Parameters<PartnerPortalSignupService['createChallenge']>
  >(async () => ({
    challengeToken: 'signed-challenge-token',
    expiresAt: new Date('2026-08-02T15:15:00.000Z'),
    readyAt: new Date('2026-08-02T15:00:01.500Z'),
  })),
  signup: jest.fn<
    ReturnType<PartnerPortalSignupService['signup']>,
    Parameters<PartnerPortalSignupService['signup']>
  >(async () => ({ status: 'VERIFICATION_REQUIRED' })),
  verifyEmail: jest.fn<
    ReturnType<PartnerPortalSignupService['verifyEmail']>,
    Parameters<PartnerPortalSignupService['verifyEmail']>
  >(async () => ({
    accessToken: 'portal-session',
    email: 'admin@atlas.example',
    expiresAt: new Date('2026-08-02T15:30:00.000Z'),
    mfaEnabled: false,
    mfaVerified: false,
    partnerName: 'Atlas Payments',
    role: PartnerPortalRole.ADMIN,
    userId: '22222222-2222-4222-8222-222222222222',
  })),
})

const signupBody = {
  challengeToken: 'signed-challenge-token-that-is-long-enough',
  company: 'Atlas Payments',
  contactWebsite: '',
  country: 'BR',
  email: ' Admin@Atlas.Example ',
  firstName: 'Ana',
  lastName: 'Silva',
  password: 'correct horse battery staple',
}

describe('PartnerPortalSignupController', () => {
  it('creates public signup challenges using the trusted-edge client address', async () => {
    const service = buildService()
    const controller = new PartnerPortalSignupController(
      service as unknown as PartnerPortalSignupService,
    )

    const result = await controller.createChallenge(request, tooManyRequestsResponder())

    expect(result.challengeToken).toBe('signed-challenge-token')
    expect(service.createChallenge).toHaveBeenCalledWith('203.0.113.10')
  })

  it('validates and forwards the minimum signup fields without the honeypot alias', async () => {
    const service = buildService()
    const controller = new PartnerPortalSignupController(
      service as unknown as PartnerPortalSignupService,
    )

    const result = await controller.signup(
      request,
      signupBody,
      'signup-request-001',
      badRequestResponder(),
      tooManyRequestsResponder(),
    )

    expect(result).toEqual({ status: 'VERIFICATION_REQUIRED' })
    expect(service.signup).toHaveBeenCalledWith({
      challengeToken: signupBody.challengeToken,
      clientIp: '203.0.113.10',
      company: signupBody.company,
      country: signupBody.country,
      email: 'Admin@Atlas.Example',
      firstName: signupBody.firstName,
      honeypot: '',
      idempotencyKey: 'signup-request-001',
      lastName: signupBody.lastName,
      password: signupBody.password,
    })
  })

  it('rejects malformed or unkeyed requests before touching signup state', async () => {
    const service = buildService()
    const controller = new PartnerPortalSignupController(
      service as unknown as PartnerPortalSignupService,
    )
    const badRequest = badRequestResponder()

    const result = await controller.signup(
      request,
      { ...signupBody, email: 'invalid-email' },
      undefined,
      badRequest,
      tooManyRequestsResponder(),
    )

    expect(result).toEqual({ reason: 'Check the signup details and try again' })
    expect(service.signup).not.toHaveBeenCalled()
  })

  it('maps rate limits and verification failures to bounded public errors', async () => {
    const rateLimitedService = buildService()
    rateLimitedService.signup.mockRejectedValueOnce(new PartnerPortalSignupRateLimitError(300))
    const rateLimitedController = new PartnerPortalSignupController(
      rateLimitedService as unknown as PartnerPortalSignupService,
    )
    const tooManyRequests = tooManyRequestsResponder()

    const rateLimitResult = await rateLimitedController.signup(
      request,
      signupBody,
      'signup-request-001',
      badRequestResponder(),
      tooManyRequests,
    )
    expect(rateLimitResult).toEqual({
      reason: 'Signup is temporarily unavailable. Try again later.',
    })
    expect(tooManyRequests).toHaveBeenCalledWith(429, expect.any(Object))

    const verificationService = buildService()
    verificationService.verifyEmail.mockRejectedValueOnce(
      new PartnerPortalEmailVerificationError(),
    )
    const verificationController = new PartnerPortalSignupController(
      verificationService as unknown as PartnerPortalSignupService,
    )
    const verificationResult = await verificationController.verifyEmail(
      request,
      { token: 'v'.repeat(43) },
      badRequestResponder(),
      tooManyRequestsResponder(),
    )
    expect(verificationResult).toEqual({
      reason: 'Verification link is invalid or expired',
    })
  })

  it('returns the existing portal session contract after successful verification', async () => {
    const service = buildService()
    const controller = new PartnerPortalSignupController(
      service as unknown as PartnerPortalSignupService,
    )

    const result = await controller.verifyEmail(
      request,
      { token: 'v'.repeat(43) },
      badRequestResponder(),
      tooManyRequestsResponder(),
    )

    expect(result).toEqual(expect.objectContaining({
      accessToken: 'portal-session',
      role: PartnerPortalRole.ADMIN,
    }))
    expect(service.verifyEmail).toHaveBeenCalledWith('203.0.113.10', 'v'.repeat(43))
  })
})
