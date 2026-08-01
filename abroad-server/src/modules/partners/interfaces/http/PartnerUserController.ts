import type { Request as ExpressRequest } from 'express'

import { type PartnerUser as PartnerUserModel, Prisma } from '@prisma/client'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  Patch,
  Path,
  Post,
  Query,
  Request,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { TYPES } from '../../../../app/container/types'
import { requireAuthenticatedPartner } from '../../../../app/http/authenticationContext'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { IPaymentServiceFactory } from '../../../payments/application/contracts/IPaymentServiceFactory'
import {
  CreatePartnerUserRequest,
  createPartnerUserSchema,
  DEFAULT_PAGE_SIZE,
  PaginatedPartnerUsers,
  parsePagination,
  parsePayload,
  PartnerUserDto,
  UpdatePartnerUserRequest,
  updatePartnerUserSchema,
} from './userContracts'

@Route('partnerUser')
export class PartnerUserController extends Controller {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,

    @inject(TYPES.IPaymentServiceFactory)
    private readonly paymentServiceFactory: IPaymentServiceFactory, // reserved for future hooks
  ) {
    super()
  }

  /* ---------------------------------------------------------------------
   * CREATE
   * ------------------------------------------------------------------ */

  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('ApiKeyAuth', ['partner-users:write'])
  @Security('BearerAuth')
  @SuccessResponse('201', 'Partner user created')
  public async createPartnerUser(
    @Body() body: CreatePartnerUserRequest,
    @Request() req: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<PartnerUserDto> {
    const validation = parsePayload(createPartnerUserSchema, body)
    if ('error' in validation) {
      return badRequest(400, { reason: validation.error })
    }

    const prisma = await this.dbProvider.getClient()
    const partner = requireAuthenticatedPartner(req.user)

    try {
      const record = await prisma.partnerUser.create({
        data: {
          kycExternalToken: validation.data.kycExternalToken ?? null,
          partnerId: partner.id,
          userId: validation.data.userId,
        },
      })

      this.setStatus(201)
      return this.mapToDto(record)
    }
    catch {
      return badRequest(400, { reason: 'Failed to create partner user' })
    }
  }

  /* ---------------------------------------------------------------------
   * READ (Paginated List)
   * ------------------------------------------------------------------ */

  @Get()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('ApiKeyAuth', ['partner-users:read'])
  @Security('BearerAuth')
  @SuccessResponse('200', 'Partner users retrieved')
  public async listPartnerUsers(
    @Query() page: number = 1,
    @Query() pageSize: number = DEFAULT_PAGE_SIZE,
    @Request() req: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<PaginatedPartnerUsers> {
    const pagination = parsePagination({ page, pageSize })
    if ('error' in pagination) {
      return badRequest(400, { reason: pagination.error })
    }

    const prisma = await this.dbProvider.getClient()
    const partner = requireAuthenticatedPartner(req.user)

    const [records, total] = await Promise.all([
      prisma.partnerUser.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (pagination.data.page - 1) * pagination.data.pageSize,
        take: pagination.data.pageSize,
        where: { partnerId: partner.id },
      }),
      prisma.partnerUser.count({ where: { partnerId: partner.id } }),
    ])

    return {
      page: pagination.data.page,
      pageSize: pagination.data.pageSize,
      total,
      users: records.map(record => this.mapToDto(record)),
    }
  }

  /* ---------------------------------------------------------------------
   * UPDATE
   * ------------------------------------------------------------------ */

  @Patch('{userId}')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('ApiKeyAuth', ['partner-users:write'])
  @Security('BearerAuth')
  @SuccessResponse('200', 'Partner user updated')
  public async updatePartnerUser(
    @Path() userId: string,
    @Body() body: UpdatePartnerUserRequest,
    @Request() req: ExpressRequest,
    @Res() res: TsoaResponse<400 | 404, { reason: string }>,
  ): Promise<PartnerUserDto> {
    const validation = parsePayload(updatePartnerUserSchema, body)
    if ('error' in validation) {
      return res(400, { reason: validation.error })
    }

    const prisma = await this.dbProvider.getClient()
    const partner = requireAuthenticatedPartner(req.user)

    try {
      const record = await prisma.partnerUser.update({
        data: validation.data,
        where: {
          partnerId_userId: {
            partnerId: partner.id,
            userId,
          },
        },
      })

      return this.mapToDto(record)
    }
    catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2025'
      ) {
        return res(404, { reason: 'Partner user not found' })
      }
      return res(400, { reason: 'Failed to update partner user' })
    }
  }

  /* --------------------------------------------------------------------
   * 🛠️  Helpers
   * ------------------------------------------------------------------ */

  private mapToDto(record: PartnerUserModel): PartnerUserDto {
    return {
      createdAt: record.createdAt,
      id: record.id,
      kycToken: record.kycExternalToken,
      updatedAt: record.updatedAt,
      userId: record.userId,
    }
  }
}
