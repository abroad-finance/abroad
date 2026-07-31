import { inject } from 'inversify'
import {
  Body,
  Controller,
  OperationId,
  Path,
  Put,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { PartnerPortalAccountNotFoundError, PartnerPortalAccountService, PartnerPortalAccountValidationError } from '../../application/PartnerPortalAccountService'
import { OpsUpsertPartnerPortalUserRequest, opsUpsertPartnerPortalUserRequestSchema, OpsUpsertPartnerPortalUserResponse, parsePartnerId } from './opsContracts'

@Route('ops/partners')
@Security('OpsApiKeyAuth')
export class OpsPartnerPortalController extends Controller {
  public constructor(
    @inject(PartnerPortalAccountService)
    private readonly partnerPortalAccountService: PartnerPortalAccountService,
  ) {
    super()
  }

  @OperationId('UpsertPartnerPortalUser')
  @Put('{partnerId}/portal-user')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @SuccessResponse('200', 'Partner portal user provisioned')
  public async upsertPortalUser(
    @Path() partnerId: string,
    @Body() body: OpsUpsertPartnerPortalUserRequest,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<OpsUpsertPartnerPortalUserResponse> {
    const parsedPartnerId = parsePartnerId(partnerId)
    if ('error' in parsedPartnerId) {
      return badRequest(400, { reason: parsedPartnerId.error })
    }

    const parsedBody = opsUpsertPartnerPortalUserRequestSchema.safeParse(body)
    if (!parsedBody.success) {
      return badRequest(400, {
        reason: parsedBody.error.issues[0]?.message ?? 'Invalid portal user',
      })
    }

    try {
      return await this.partnerPortalAccountService.provision(
        parsedPartnerId.data,
        parsedBody.data,
      )
    }
    catch (error) {
      if (error instanceof PartnerPortalAccountNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      if (error instanceof PartnerPortalAccountValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }
}
