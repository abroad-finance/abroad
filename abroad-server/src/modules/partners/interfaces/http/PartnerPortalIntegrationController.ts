import type { Request as ExpressRequest } from 'express'

import { inject } from 'inversify'
import {
  Body,
  Controller,
  Delete,
  Get,
  Path,
  Post,
  Put,
  Request,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'
import { z } from 'zod'

import { requirePartnerPortalMfaAdministrator } from '../../../../app/http/authenticationContext'
import { partnerApiKeyScopeNames } from '../../application/partnerApiKeyScopes'
import {
  PartnerPortalApiKeyList,
  PartnerPortalApiKeyNotFoundError,
  PartnerPortalApiKeySecretResult,
  PartnerPortalApiKeyService,
  PartnerPortalApiKeySummary,
  PartnerPortalApiKeyValidationError,
} from '../../application/PartnerPortalApiKeyService'
import {
  PartnerPortalWebhookConfigurationDto,
  PartnerPortalWebhookSecretResult,
  PartnerPortalWebhookService,
  PartnerPortalWebhookTestResult,
  PartnerPortalWebhookValidationError,
} from '../../application/PartnerPortalWebhookService'

type PartnerPortalIntegrationErrorResponse = { reason: string }

const apiKeyCreateSchema = z.object({
  expiresAt: z.string().datetime({ offset: true }).optional(),
  name: z.string().trim().min(1).max(64),
  scopes: z.array(z.enum(partnerApiKeyScopeNames)).min(1).max(partnerApiKeyScopeNames.length),
}).strict()

@Route('partner-portal/integration')
@Security('PartnerPortalAuth', ['admin', 'mfa'])
export class PartnerPortalIntegrationController extends Controller {
  public constructor(
    @inject(PartnerPortalApiKeyService)
    private readonly apiKeyService: PartnerPortalApiKeyService,
    @inject(PartnerPortalWebhookService)
    private readonly webhookService: PartnerPortalWebhookService,
  ) {
    super()
  }

  @Post('webhook/activation')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'Webhook draft activated')
  public async activateWebhook(
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, PartnerPortalIntegrationErrorResponse>,
  ): Promise<PartnerPortalWebhookConfigurationDto> {
    try {
      return await this.webhookService.activate(
        requirePartnerPortalMfaAdministrator(request.user),
      )
    }
    catch (error) {
      return this.handleWebhookError(error, badRequest)
    }
  }

  @Post('api-keys')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('201', 'API key created')
  public async createApiKey(
    @Request() request: ExpressRequest,
    @Body() body: { expiresAt?: string, name: string, scopes: string[] },
    @Res() badRequest: TsoaResponse<400, PartnerPortalIntegrationErrorResponse>,
    @Res() created: TsoaResponse<201, PartnerPortalApiKeySecretResult>,
  ): Promise<PartnerPortalApiKeySecretResult> {
    this.setHeader('Cache-Control', 'private, no-store')
    const parsed = apiKeyCreateSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { reason: 'Enter a valid name, scope, and expiry' })
    }
    try {
      const result = await this.apiKeyService.create(
        requirePartnerPortalMfaAdministrator(request.user),
        {
          expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
          name: parsed.data.name,
          scopes: parsed.data.scopes,
        },
      )
      return created(201, result)
    }
    catch (error) {
      if (error instanceof PartnerPortalApiKeyValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  @Delete('webhook/draft')
  @SuccessResponse('200', 'Webhook draft discarded')
  public async discardWebhookDraft(
    @Request() request: ExpressRequest,
  ): Promise<PartnerPortalWebhookConfigurationDto> {
    return this.webhookService.discardDraft(
      requirePartnerPortalMfaAdministrator(request.user),
    )
  }

  @Get('webhook')
  @SuccessResponse('200', 'Webhook configuration retrieved')
  public async getWebhookConfiguration(
    @Request() request: ExpressRequest,
  ): Promise<PartnerPortalWebhookConfigurationDto> {
    const principal = requirePartnerPortalMfaAdministrator(request.user)
    return this.webhookService.getConfiguration(principal.partner.id)
  }

  @Get('api-keys')
  @SuccessResponse('200', 'API keys retrieved')
  public async listApiKeys(
    @Request() request: ExpressRequest,
  ): Promise<PartnerPortalApiKeyList> {
    const principal = requirePartnerPortalMfaAdministrator(request.user)
    return this.apiKeyService.list(principal.partner.id)
  }

  @Delete('api-keys/{apiKeyId}')
  @Response<404, { reason: string }>(404, 'Not Found')
  @SuccessResponse('200', 'API key revoked')
  public async revokeApiKey(
    @Path() apiKeyId: string,
    @Request() request: ExpressRequest,
    @Res() notFound: TsoaResponse<404, PartnerPortalIntegrationErrorResponse>,
  ): Promise<PartnerPortalApiKeySummary> {
    try {
      return await this.apiKeyService.revoke(
        requirePartnerPortalMfaAdministrator(request.user),
        apiKeyId,
      )
    }
    catch (error) {
      if (error instanceof PartnerPortalApiKeyNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      throw error
    }
  }

  @Post('api-keys/{apiKeyId}/rotation')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @SuccessResponse('200', 'API key rotated')
  public async rotateApiKey(
    @Path() apiKeyId: string,
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, PartnerPortalIntegrationErrorResponse>,
    @Res() notFound: TsoaResponse<404, PartnerPortalIntegrationErrorResponse>,
  ): Promise<PartnerPortalApiKeySecretResult> {
    this.setHeader('Cache-Control', 'private, no-store')
    try {
      return await this.apiKeyService.rotate(
        requirePartnerPortalMfaAdministrator(request.user),
        apiKeyId,
      )
    }
    catch (error) {
      if (error instanceof PartnerPortalApiKeyValidationError) {
        return badRequest(400, { reason: error.message })
      }
      if (error instanceof PartnerPortalApiKeyNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      throw error
    }
  }

  @Post('webhook/secret-rotation')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'Webhook signing secret rotation staged')
  public async rotateWebhookSecret(
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, PartnerPortalIntegrationErrorResponse>,
  ): Promise<PartnerPortalWebhookSecretResult> {
    this.setHeader('Cache-Control', 'private, no-store')
    try {
      return await this.webhookService.rotateSecret(
        requirePartnerPortalMfaAdministrator(request.user),
      )
    }
    catch (error) {
      return this.handleWebhookError(error, badRequest)
    }
  }

  @Put('webhook/draft')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'Webhook URL staged')
  public async stageWebhookUrl(
    @Request() request: ExpressRequest,
    @Body() body: { url: string },
    @Res() badRequest: TsoaResponse<400, PartnerPortalIntegrationErrorResponse>,
  ): Promise<PartnerPortalWebhookConfigurationDto> {
    const parsed = z.object({
      url: z.string().trim().url().max(2_048),
    }).strict().safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { reason: 'Enter a valid HTTPS webhook URL' })
    }
    try {
      return await this.webhookService.stageUrl(
        requirePartnerPortalMfaAdministrator(request.user),
        parsed.data.url,
      )
    }
    catch (error) {
      return this.handleWebhookError(error, badRequest)
    }
  }

  @Post('webhook/test')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'Webhook draft tested')
  public async testWebhookDraft(
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, PartnerPortalIntegrationErrorResponse>,
  ): Promise<PartnerPortalWebhookTestResult> {
    try {
      return await this.webhookService.testDraft(
        requirePartnerPortalMfaAdministrator(request.user),
      )
    }
    catch (error) {
      return this.handleWebhookError(error, badRequest)
    }
  }

  private handleWebhookError<T>(
    error: unknown,
    badRequest: TsoaResponse<400, PartnerPortalIntegrationErrorResponse>,
  ): T {
    if (error instanceof PartnerPortalWebhookValidationError) {
      return badRequest(400, { reason: error.message }) as T
    }
    throw error
  }
}
