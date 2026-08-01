import type { Request as ExpressRequest } from 'express'

import { inject } from 'inversify'
import {
  Body,
  Controller,
  Patch,
  Post,
  Request,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'
import { z } from 'zod'

import { requirePartnerPortalPrincipal } from '../../../../app/http/authenticationContext'
import {
  PartnerPortalIdentityAuthenticationError,
  PartnerPortalIdentityService,
  PartnerPortalIdentityValidationError,
  PartnerPortalMfaConfirmationResult,
  PartnerPortalMfaEnrollmentResult,
} from '../../application/PartnerPortalIdentityService'
import { PartnerPortalSession } from '../../application/PartnerPortalSessionService'

type PartnerPortalIdentityErrorResponse = { reason: string }

const currentPasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
}).strict()

const mfaChallengeSchema = z.object({
  challengeToken: z.string().min(32).max(4_096),
  code: z.string().trim().min(6).max(32),
}).strict()

const mfaConfirmationSchema = z.object({
  code: z.string().trim().min(6).max(32),
}).strict()

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
}).strict()

const passwordRecoverySchema = z.object({
  email: z.string().trim().email().max(254),
  newPassword: z.string().min(1).max(128),
  recoveryCode: z.string().trim().min(6).max(64),
}).strict()

const passwordResetSchema = z.object({
  newPassword: z.string().min(1).max(128),
  token: z.string().trim().min(32).max(256),
}).strict()

@Route('partner-portal')
export class PartnerPortalIdentityController extends Controller {
  public constructor(
    @inject(PartnerPortalIdentityService)
    private readonly identityService: PartnerPortalIdentityService,
  ) {
    super()
  }

  @Post('security/mfa/enrollment')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<401, { reason: string }>(401, 'Unauthorized')
  @Security('PartnerPortalAuth')
  @SuccessResponse('200', 'MFA enrollment started')
  public async beginMfaEnrollment(
    @Request() request: ExpressRequest,
    @Body() body: { currentPassword: string },
    @Res() badRequest: TsoaResponse<400, PartnerPortalIdentityErrorResponse>,
    @Res() unauthorized: TsoaResponse<401, PartnerPortalIdentityErrorResponse>,
  ): Promise<PartnerPortalMfaEnrollmentResult> {
    this.setHeader('Cache-Control', 'private, no-store')
    const parsed = currentPasswordSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { reason: 'Current password is required' })
    }
    try {
      return await this.identityService.beginMfaEnrollment(
        requirePartnerPortalPrincipal(request.user),
        parsed.data.currentPassword,
      )
    }
    catch (error) {
      return this.handleIdentityError(error, badRequest, unauthorized)
    }
  }

  @Patch('security/password')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<401, { reason: string }>(401, 'Unauthorized')
  @Security('PartnerPortalAuth')
  @SuccessResponse('204', 'Password changed')
  public async changePassword(
    @Request() request: ExpressRequest,
    @Body() body: { currentPassword: string, newPassword: string },
    @Res() badRequest: TsoaResponse<400, PartnerPortalIdentityErrorResponse>,
    @Res() unauthorized: TsoaResponse<401, PartnerPortalIdentityErrorResponse>,
  ): Promise<void> {
    const parsed = passwordChangeSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { reason: 'Enter the current and new passwords' })
    }
    try {
      await this.identityService.changePassword(
        requirePartnerPortalPrincipal(request.user),
        parsed.data.currentPassword,
        parsed.data.newPassword,
      )
      this.setStatus(204)
    }
    catch (error) {
      return this.handleIdentityError(error, badRequest, unauthorized)
    }
  }

  @Post('session/mfa')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<401, { reason: string }>(401, 'Unauthorized')
  @SuccessResponse('200', 'MFA challenge completed')
  public async completeMfaChallenge(
    @Body() body: { challengeToken: string, code: string },
    @Res() badRequest: TsoaResponse<400, PartnerPortalIdentityErrorResponse>,
    @Res() unauthorized: TsoaResponse<401, PartnerPortalIdentityErrorResponse>,
  ): Promise<PartnerPortalSession> {
    this.setHeader('Cache-Control', 'no-store')
    const parsed = mfaChallengeSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { reason: 'Enter a valid authentication code' })
    }
    try {
      return await this.identityService.completeMfaChallenge(
        parsed.data.challengeToken,
        parsed.data.code,
      )
    }
    catch (error) {
      return this.handleIdentityError(error, badRequest, unauthorized)
    }
  }

  @Post('security/mfa/confirmation')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<401, { reason: string }>(401, 'Unauthorized')
  @Security('PartnerPortalAuth')
  @SuccessResponse('200', 'MFA enrollment completed')
  public async confirmMfaEnrollment(
    @Request() request: ExpressRequest,
    @Body() body: { code: string },
    @Res() badRequest: TsoaResponse<400, PartnerPortalIdentityErrorResponse>,
    @Res() unauthorized: TsoaResponse<401, PartnerPortalIdentityErrorResponse>,
  ): Promise<PartnerPortalMfaConfirmationResult> {
    this.setHeader('Cache-Control', 'private, no-store')
    const parsed = mfaConfirmationSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { reason: 'Enter a valid authenticator code' })
    }
    try {
      return await this.identityService.confirmMfaEnrollment(
        requirePartnerPortalPrincipal(request.user),
        parsed.data.code,
      )
    }
    catch (error) {
      return this.handleIdentityError(error, badRequest, unauthorized)
    }
  }

  @Post('security/mfa/recovery-codes')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<401, { reason: string }>(401, 'Unauthorized')
  @Security('PartnerPortalAuth', ['mfa'])
  @SuccessResponse('200', 'MFA recovery codes regenerated')
  public async regenerateRecoveryCodes(
    @Request() request: ExpressRequest,
    @Body() body: { currentPassword: string },
    @Res() badRequest: TsoaResponse<400, PartnerPortalIdentityErrorResponse>,
    @Res() unauthorized: TsoaResponse<401, PartnerPortalIdentityErrorResponse>,
  ): Promise<{ recoveryCodes: string[] }> {
    this.setHeader('Cache-Control', 'private, no-store')
    const parsed = currentPasswordSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { reason: 'Current password is required' })
    }
    try {
      return {
        recoveryCodes: await this.identityService.regenerateRecoveryCodes(
          requirePartnerPortalPrincipal(request.user),
          parsed.data.currentPassword,
        ),
      }
    }
    catch (error) {
      return this.handleIdentityError(error, badRequest, unauthorized)
    }
  }

  @Post('session/password/recovery')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<401, { reason: string }>(401, 'Unauthorized')
  @SuccessResponse('204', 'Password recovered')
  public async resetPasswordWithRecoveryCode(
    @Body() body: { email: string, newPassword: string, recoveryCode: string },
    @Res() badRequest: TsoaResponse<400, PartnerPortalIdentityErrorResponse>,
    @Res() unauthorized: TsoaResponse<401, PartnerPortalIdentityErrorResponse>,
  ): Promise<void> {
    this.setHeader('Cache-Control', 'no-store')
    const parsed = passwordRecoverySchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { reason: 'Enter valid recovery details' })
    }
    try {
      await this.identityService.resetPasswordWithRecoveryCode(
        parsed.data.email,
        parsed.data.recoveryCode,
        parsed.data.newPassword,
      )
      this.setStatus(204)
    }
    catch (error) {
      return this.handleIdentityError(error, badRequest, unauthorized)
    }
  }

  @Post('session/password/reset')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<401, { reason: string }>(401, 'Unauthorized')
  @SuccessResponse('204', 'Password reset')
  public async resetPasswordWithToken(
    @Body() body: { newPassword: string, token: string },
    @Res() badRequest: TsoaResponse<400, PartnerPortalIdentityErrorResponse>,
    @Res() unauthorized: TsoaResponse<401, PartnerPortalIdentityErrorResponse>,
  ): Promise<void> {
    this.setHeader('Cache-Control', 'no-store')
    const parsed = passwordResetSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { reason: 'Reset link or password is invalid' })
    }
    try {
      await this.identityService.resetPasswordWithToken(
        parsed.data.token,
        parsed.data.newPassword,
      )
      this.setStatus(204)
    }
    catch (error) {
      return this.handleIdentityError(error, badRequest, unauthorized)
    }
  }

  private handleIdentityError<T>(
    error: unknown,
    badRequest: TsoaResponse<400, PartnerPortalIdentityErrorResponse>,
    unauthorized: TsoaResponse<401, PartnerPortalIdentityErrorResponse>,
  ): T {
    if (error instanceof PartnerPortalIdentityValidationError) {
      return badRequest(400, { reason: error.message }) as T
    }
    if (error instanceof PartnerPortalIdentityAuthenticationError) {
      return unauthorized(401, { reason: error.message }) as T
    }
    throw error
  }
}
