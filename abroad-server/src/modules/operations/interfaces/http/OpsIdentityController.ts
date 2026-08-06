import type { Request as ExpressRequest } from 'express'

import { inject } from 'inversify'
import {
  Controller,
  Get,
  Header,
  OperationId,
  Post,
  Request,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { TYPES } from '../../../../app/container/types'
import { requireOpsExternalIdentity, requireOpsPrincipal } from '../../../../app/http/authenticationContext'
import { OpsAuthService } from '../../../../app/http/OpsAuthService'
import { OpsAuthenticationError, OpsPrincipal } from '../../application/opsIdentity'
import { OpsBootstrapConflictError, OpsIdentityAdmissionError, OpsIdentityService, OpsIdentitySession } from '../../application/OpsIdentityService'
import { OPS_MUTATION_POLICIES } from '../../application/opsMutation'

const FIREBASE_CONFIG_PATH = '/__/firebase/init.json'
const OPS_EMAIL_DOMAIN = 'abroad.finance'
const STEP_UP_MAX_AGE_SECONDS = 10 * 60

type OpsIdentityConfigDto = {
  allowedEmailDomain: string
  firebaseConfigPath: string
  mutationPolicies: OpsMutationPolicyDto[]
  provider: 'google.com'
  stepUpMaxAgeSeconds: number
}

type OpsMutationPolicyDto = {
  action: string
  approvalClass: string
  confirmation: string
  expectedVersion: boolean
  impact: string
  permission: string
  stepUpRequired: boolean
}

type OpsSessionDto = {
  authenticatedAt: Date | null
  bootstrapRequired: boolean
  displayName: string
  email: null | string
  kind: OpsPrincipal['kind']
  permissions: string[]
  role: null | OpsIdentitySession['principal']['role']
  sessionVersion: null | number
  stepUpExpiresAt: Date | null
  userId: null | string
}

@Route('ops/auth')
export class OpsIdentityController extends Controller {
  public constructor(
    @inject(OpsIdentityService)
    private readonly identityService: OpsIdentityService,
    @inject(TYPES.IOpsAuthService)
    private readonly opsAuthService: OpsAuthService,
  ) {
    super()
  }

  @OperationId('BootstrapOpsAdministrator')
  @Post('bootstrap')
  @Response<401, { reason: string }>(401, 'Unauthorized')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsFirebaseAuth')
  @SuccessResponse('200', 'Ops administrator bootstrapped')
  public async bootstrapAdministrator(
    @Header('X-OPS-API-KEY') legacyOpsKey: string,
    @Request() request: ExpressRequest,
    @Res() unauthorized: TsoaResponse<401, { reason: string }>,
    @Res() conflict: TsoaResponse<409, { reason: string }>,
  ): Promise<OpsSessionDto> {
    try {
      await this.opsAuthService.verifyOpsApiKey(legacyOpsKey)
      const session = await this.identityService.bootstrapAdministrator(
        requireOpsExternalIdentity(request.user),
      )
      this.setHeader('Cache-Control', 'private, no-store')
      return this.toSessionDto(session.principal, session.bootstrapRequired)
    }
    catch (error) {
      if (error instanceof OpsAuthenticationError || error instanceof OpsIdentityAdmissionError) {
        return unauthorized(401, { reason: error.message })
      }
      if (error instanceof OpsBootstrapConflictError) {
        return conflict(409, { reason: error.message })
      }
      throw error
    }
  }

  @OperationId('CreateOpsSession')
  @Post('session')
  @Response<401, { reason: string }>(401, 'Unauthorized')
  @Security('OpsFirebaseAuth')
  @SuccessResponse('200', 'Ops session created')
  public async createSession(
    @Request() request: ExpressRequest,
    @Res() unauthorized: TsoaResponse<401, { reason: string }>,
  ): Promise<OpsSessionDto> {
    try {
      const session = await this.identityService.admit(
        requireOpsExternalIdentity(request.user),
      )
      this.setHeader('Cache-Control', 'private, no-store')
      return this.toSessionDto(session.principal, session.bootstrapRequired)
    }
    catch (error) {
      if (error instanceof OpsAuthenticationError || error instanceof OpsIdentityAdmissionError) {
        return unauthorized(401, { reason: error.message })
      }
      throw error
    }
  }

  @Get('config')
  @OperationId('GetOpsIdentityConfig')
  public getConfig(): OpsIdentityConfigDto {
    this.setHeader('Cache-Control', 'public, max-age=300')
    return {
      allowedEmailDomain: OPS_EMAIL_DOMAIN,
      firebaseConfigPath: FIREBASE_CONFIG_PATH,
      mutationPolicies: Object.entries(OPS_MUTATION_POLICIES).map(([action, policy]) => ({
        action,
        approvalClass: policy.approvalClass,
        confirmation: policy.confirmation,
        expectedVersion: policy.expectedVersion,
        impact: policy.impact,
        permission: policy.permission,
        stepUpRequired: policy.stepUpMaxAgeMs !== null,
      })),
      provider: 'google.com',
      stepUpMaxAgeSeconds: STEP_UP_MAX_AGE_SECONDS,
    }
  }

  @Get('me')
  @OperationId('GetOpsSession')
  @Security('OpsAuth')
  public async getSession(
    @Request() request: ExpressRequest,
  ): Promise<OpsSessionDto> {
    this.setHeader('Cache-Control', 'private, no-store')
    return this.toSessionDto(
      requireOpsPrincipal(request.user),
      await this.identityService.isBootstrapRequired(),
    )
  }

  private toSessionDto(
    principal: OpsPrincipal,
    bootstrapRequired: boolean,
  ): OpsSessionDto {
    const stepUpExpiresAt = principal.authTime
      ? new Date(principal.authTime.getTime() + STEP_UP_MAX_AGE_SECONDS * 1_000)
      : null
    return {
      authenticatedAt: principal.authTime,
      bootstrapRequired,
      displayName: principal.displayName,
      email: principal.email,
      kind: principal.kind,
      permissions: [...principal.permissions],
      role: principal.role,
      sessionVersion: principal.sessionVersion,
      stepUpExpiresAt,
      userId: principal.userId,
    }
  }
}
