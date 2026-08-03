import type { Request as ExpressRequest } from 'express'

import { inject } from 'inversify'
import {
  Body,
  Controller,
  Header,
  OperationId,
  Post,
  Request,
  Res,
  Response,
  Route,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'
import { z } from 'zod'

import { PartnerPortalSession } from '../../application/PartnerPortalSessionService'
import { PartnerPortalSignupChallenge, PartnerPortalSignupProtectionError, PartnerPortalSignupRateLimitError } from '../../application/PartnerPortalSignupProtectionService'
import {
  PartnerPortalEmailVerificationError,
  PartnerPortalPublicSignupInput,
  PartnerPortalSignupAcknowledgement,
  PartnerPortalSignupService,
  PartnerPortalSignupValidationError,
  PartnerPortalVerificationEmailResendInput,
} from '../../application/PartnerPortalSignupService'
import { readPartnerPortalClientIp } from './partnerPortalClientIp'

type PartnerPortalEmailVerificationRequest = {
  token: string
}

type PartnerPortalPublicSignupRequest = Pick<
  PartnerPortalPublicSignupInput,
  'challengeToken' | 'company' | 'country' | 'email' | 'firstName' | 'lastName' | 'password'
> & {
  contactWebsite?: string
}

type PartnerPortalSignupErrorResponse = { reason: string }

type PartnerPortalVerificationEmailResendRequest = Pick<
  PartnerPortalVerificationEmailResendInput,
  'challengeToken' | 'email' | 'password'
> & {
  contactWebsite?: string
}

const emailVerificationSchema = z.object({
  token: z.string().trim().min(32).max(256),
}).strict() satisfies z.ZodType<PartnerPortalEmailVerificationRequest>

const signupSchema = z.object({
  challengeToken: z.string().trim().min(32).max(4_096),
  company: z.string().min(1).max(160),
  contactWebsite: z.string().max(256).optional(),
  country: z.string().min(1).max(64),
  email: z.string().trim().email().max(254),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  password: z.string().min(12).max(128),
}).strict() satisfies z.ZodType<PartnerPortalPublicSignupRequest>

const resendSchema = z.object({
  challengeToken: z.string().trim().min(32).max(4_096),
  contactWebsite: z.string().max(256).optional(),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
}).strict() satisfies z.ZodType<PartnerPortalVerificationEmailResendRequest>

@Route('partner-portal/signup')
export class PartnerPortalSignupController extends Controller {
  public constructor(
    @inject(PartnerPortalSignupService)
    private readonly signupService: PartnerPortalSignupService,
  ) {
    super()
  }

  @OperationId('CreatePartnerPortalSignupChallenge')
  @Post('challenge')
  @Response<PartnerPortalSignupErrorResponse>(429, 'Too Many Requests')
  @SuccessResponse('200', 'Signup challenge created')
  public async createChallenge(
    @Request() request: ExpressRequest,
    @Res() tooManyRequests: TsoaResponse<429, PartnerPortalSignupErrorResponse>,
  ): Promise<PartnerPortalSignupChallenge> {
    this.setHeader('Cache-Control', 'no-store')
    try {
      return await this.signupService.createChallenge(readPartnerPortalClientIp(request))
    }
    catch (error) {
      if (error instanceof PartnerPortalSignupRateLimitError) {
        this.setHeader('Retry-After', String(error.retryAfterSeconds))
        return tooManyRequests(429, { reason: error.message })
      }
      throw error
    }
  }

  @OperationId('ResendPartnerPortalSignupVerificationEmail')
  @Post('email-verification/resend')
  @Response<PartnerPortalSignupErrorResponse>(400, 'Bad Request')
  @Response<PartnerPortalSignupErrorResponse>(429, 'Too Many Requests')
  @SuccessResponse('202', 'Email verification recovery accepted')
  public async resendVerificationEmail(
    @Request() request: ExpressRequest,
    @Body() body: PartnerPortalVerificationEmailResendRequest,
    @Res() badRequest: TsoaResponse<400, PartnerPortalSignupErrorResponse>,
    @Res() tooManyRequests: TsoaResponse<429, PartnerPortalSignupErrorResponse>,
  ): Promise<PartnerPortalSignupAcknowledgement> {
    this.setHeader('Cache-Control', 'no-store')
    const parsedBody = resendSchema.safeParse(body)
    if (!parsedBody.success) {
      return badRequest(400, { reason: 'Check the email and password and try again' })
    }
    try {
      const { contactWebsite, ...resendFields } = parsedBody.data
      const result = await this.signupService.resendVerificationEmail({
        ...resendFields,
        clientIp: readPartnerPortalClientIp(request),
        honeypot: contactWebsite ?? '',
      })
      this.setStatus(202)
      return result
    }
    catch (error) {
      if (
        error instanceof PartnerPortalSignupProtectionError
        || error instanceof PartnerPortalSignupValidationError
      ) {
        return badRequest(400, { reason: 'Check the email and password and try again' })
      }
      if (error instanceof PartnerPortalSignupRateLimitError) {
        this.setHeader('Retry-After', String(error.retryAfterSeconds))
        return tooManyRequests(429, { reason: error.message })
      }
      throw error
    }
  }

  @OperationId('CreatePartnerPortalSignup')
  @Post()
  @Response<PartnerPortalSignupErrorResponse>(400, 'Bad Request')
  @Response<PartnerPortalSignupErrorResponse>(429, 'Too Many Requests')
  @SuccessResponse('202', 'Email verification required')
  public async signup(
    @Request() request: ExpressRequest,
    @Body() body: PartnerPortalPublicSignupRequest,
    @Header('Idempotency-Key') idempotencyKey: string | undefined,
    @Res() badRequest: TsoaResponse<400, PartnerPortalSignupErrorResponse>,
    @Res() tooManyRequests: TsoaResponse<429, PartnerPortalSignupErrorResponse>,
  ): Promise<PartnerPortalSignupAcknowledgement> {
    this.setHeader('Cache-Control', 'no-store')
    const parsedBody = signupSchema.safeParse(body)
    if (!parsedBody.success || !idempotencyKey) {
      return badRequest(400, { reason: 'Check the signup details and try again' })
    }
    try {
      const { contactWebsite, ...signupFields } = parsedBody.data
      const result = await this.signupService.signup({
        ...signupFields,
        clientIp: readPartnerPortalClientIp(request),
        honeypot: contactWebsite ?? '',
        idempotencyKey,
      })
      this.setStatus(202)
      return result
    }
    catch (error) {
      if (
        error instanceof PartnerPortalSignupProtectionError
        || error instanceof PartnerPortalSignupValidationError
      ) {
        return badRequest(400, { reason: 'Check the signup details and try again' })
      }
      if (error instanceof PartnerPortalSignupRateLimitError) {
        this.setHeader('Retry-After', String(error.retryAfterSeconds))
        return tooManyRequests(429, { reason: error.message })
      }
      throw error
    }
  }

  @OperationId('VerifyPartnerPortalSignupEmail')
  @Post('email-verification')
  @Response<PartnerPortalSignupErrorResponse>(400, 'Bad Request')
  @Response<PartnerPortalSignupErrorResponse>(429, 'Too Many Requests')
  @SuccessResponse('200', 'Email verified and session created')
  public async verifyEmail(
    @Request() request: ExpressRequest,
    @Body() body: PartnerPortalEmailVerificationRequest,
    @Res() badRequest: TsoaResponse<400, PartnerPortalSignupErrorResponse>,
    @Res() tooManyRequests: TsoaResponse<429, PartnerPortalSignupErrorResponse>,
  ): Promise<PartnerPortalSession> {
    this.setHeader('Cache-Control', 'no-store')
    const parsedBody = emailVerificationSchema.safeParse(body)
    if (!parsedBody.success) {
      return badRequest(400, { reason: 'Verification link is invalid or expired' })
    }
    try {
      return await this.signupService.verifyEmail(
        readPartnerPortalClientIp(request),
        parsedBody.data.token,
      )
    }
    catch (error) {
      if (error instanceof PartnerPortalEmailVerificationError) {
        return badRequest(400, { reason: error.message })
      }
      if (error instanceof PartnerPortalSignupRateLimitError) {
        this.setHeader('Retry-After', String(error.retryAfterSeconds))
        return tooManyRequests(429, { reason: error.message })
      }
      throw error
    }
  }
}
