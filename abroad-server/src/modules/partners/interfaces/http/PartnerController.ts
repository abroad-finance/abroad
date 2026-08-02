// src/modules/partners/interfaces/http/PartnerController.ts

import { Partner } from '@prisma/client'
import { Request as RequestExpress } from 'express'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  Hidden,
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
import { requireAuthenticatedPartner, requireOpsPrincipal } from '../../../../app/http/authenticationContext'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { OpsMutationService } from '../../../operations/application/opsMutation'
import { readOpsMutationEnvelope } from '../../../operations/interfaces/http/opsMutationHeaders'
import { normalizeClientDomainInput } from '../../domain/clientDomain'
import { type CreatePartnerRequest, createPartnerRequestSchema, type CreatePartnerResponse, type PartnerInfoResponse } from './contracts'

@Route('partner')
export class PartnerController extends Controller {
  constructor(
    @inject(TYPES.IDatabaseClientProvider) private dbProvider: IDatabaseClientProvider,
    @inject(OpsMutationService) private readonly mutationService: OpsMutationService,
  ) {
    super()
  }

  /**
   * Create a new partner
   */
  @Hidden()
  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('OpsAuth', ['partners:manage'])
  @SuccessResponse('201', 'Partner created')
  public async createPartner(
    @Body() body: CreatePartnerRequest,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() created: TsoaResponse<201, CreatePartnerResponse>,
  ): Promise<CreatePartnerResponse> {
    const parsedBody = createPartnerRequestSchema.safeParse(body)
    if (!parsedBody.success) {
      return badRequest(400, { reason: parsedBody.error.message })
    }
    const partnerData = parsedBody.data
    let clientDomainRecord: { clientDomain: null | string, clientDomainHash: null | string }
    try {
      clientDomainRecord = normalizeClientDomainInput(partnerData.clientDomain)
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'Client domain is invalid'
      return badRequest(400, { reason })
    }

    const dbClient = await this.dbProvider.getClient()

    let partner: Partner
    try {
      partner = await this.mutationService.execute(
        requireOpsPrincipal(request.user),
        'partner.create',
        { type: 'partner' },
        readOpsMutationEnvelope(request),
        () => dbClient.partner.create({
          data: {
            clientDomain: clientDomainRecord.clientDomain,
            clientDomainHash: clientDomainRecord.clientDomainHash,
            country: partnerData.country,
            email: partnerData.email,
            firstName: partnerData.firstName,
            lastName: partnerData.lastName,
            name: partnerData.company,
            phone: partnerData.phone,
          },
        }),
        createdPartner => ({ resourceId: createdPartner.id }),
      )
    }
    catch {
      return badRequest(400, { reason: 'Failed to create partner in the database' })
    }

    return created(201, {
      id: partner.id,
    })
  }

  /**
   * Retrieve the authenticated partner's info
   */
  @Get()
  @Security('BearerAuth')
  @Security('ApiKeyAuth', ['transactions:read'])
  @SuccessResponse('200', 'Partner info retrieved')
  public async getPartnerInfo(
    @Request() request: RequestExpress,
  ): Promise<PartnerInfoResponse> {
    const partner = requireAuthenticatedPartner(request.user)
    return {
      country: partner.country ?? undefined,
      createdAt: partner.createdAt,
      email: partner.email ?? undefined,
      firstName: partner.firstName ?? undefined,
      id: partner.id,
      isKybApproved: partner.isKybApproved ?? false,
      lastName: partner.lastName ?? undefined,
      name: partner.name,
      needsKyc: partner.needsKyc ?? false,
      phone: partner.phone ?? undefined,
    }
  }
}
