import { inject } from 'inversify'
import {
  Body,
  Controller,
  Delete,
  Get,
  OperationId,
  Patch,
  Path,
  Post,
  Query,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { OpsPartnerNotFoundError, OpsPartnerService, OpsPartnerValidationError } from '../../application/OpsPartnerService'
import {
  OpsCreatePartnerRequest,
  opsCreatePartnerRequestSchema,
  OpsCreatePartnerResponse,
  OpsPartnerListResponse,
  OpsRotatePartnerApiKeyResponse,
  OpsUpdatePartnerClientDomainRequest,
  opsUpdatePartnerClientDomainRequestSchema,
  OpsUpdatePartnerClientDomainResponse,
  parsePartnerId,
  parsePartnerPagination,
} from './opsContracts'

@Route('ops/partners')
@Security('OpsApiKeyAuth')
export class OpsPartnerController extends Controller {
  constructor(
    @inject(OpsPartnerService) private readonly opsPartnerService: OpsPartnerService,
  ) {
    super()
  }

  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('201', 'Partner created')
  public async createPartner(
    @Body() body: OpsCreatePartnerRequest,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() created: TsoaResponse<201, OpsCreatePartnerResponse>,
  ): Promise<OpsCreatePartnerResponse> {
    const parsedBody = opsCreatePartnerRequestSchema.safeParse(body)
    if (!parsedBody.success) {
      return badRequest(400, { reason: parsedBody.error.message })
    }

    try {
      const result = await this.opsPartnerService.createPartner(parsedBody.data)
      return created(201, result)
    }
    catch (error) {
      if (error instanceof OpsPartnerValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  @Get()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'Partners retrieved')
  public async listPartners(
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<OpsPartnerListResponse> {
    const parsed = parsePartnerPagination({ page, pageSize })
    if ('error' in parsed) {
      return badRequest(400, { reason: parsed.error })
    }

    return this.opsPartnerService.listPartners(parsed.data)
  }

  @Delete('{partnerId}/api-key')
  @OperationId('RevokePartnerApiKey')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @SuccessResponse('204', 'Partner API key revoked')
  public async revokeApiKey(
    @Path() partnerId: string,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<void> {
    const parsedPartnerId = parsePartnerId(partnerId)
    if ('error' in parsedPartnerId) {
      badRequest(400, { reason: parsedPartnerId.error })
      return
    }

    try {
      await this.opsPartnerService.revokeApiKey(parsedPartnerId.data)
      this.setStatus(204)
    }
    catch (error) {
      if (error instanceof OpsPartnerNotFoundError) {
        notFound(404, { reason: error.message })
        return
      }
      throw error
    }
  }

  @OperationId('RotatePartnerApiKey')
  @Post('{partnerId}/api-key')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @SuccessResponse('200', 'Partner API key rotated')
  public async rotateApiKey(
    @Path() partnerId: string,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<OpsRotatePartnerApiKeyResponse> {
    const parsedPartnerId = parsePartnerId(partnerId)
    if ('error' in parsedPartnerId) {
      return badRequest(400, { reason: parsedPartnerId.error })
    }

    try {
      return await this.opsPartnerService.rotateApiKey(parsedPartnerId.data)
    }
    catch (error) {
      if (error instanceof OpsPartnerNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      if (error instanceof OpsPartnerValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  @OperationId('UpdatePartnerClientDomain')
  @Patch('{partnerId}/client-domain')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @SuccessResponse('200', 'Partner client domain updated')
  public async updateClientDomain(
    @Path() partnerId: string,
    @Body() body: OpsUpdatePartnerClientDomainRequest,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<OpsUpdatePartnerClientDomainResponse> {
    const parsedPartnerId = parsePartnerId(partnerId)
    if ('error' in parsedPartnerId) {
      return badRequest(400, { reason: parsedPartnerId.error })
    }

    const parsedBody = opsUpdatePartnerClientDomainRequestSchema.safeParse(body)
    if (!parsedBody.success) {
      return badRequest(400, { reason: parsedBody.error.message })
    }

    try {
      return await this.opsPartnerService.updateClientDomain(parsedPartnerId.data, parsedBody.data)
    }
    catch (error) {
      if (error instanceof OpsPartnerNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      if (error instanceof OpsPartnerValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }
}
