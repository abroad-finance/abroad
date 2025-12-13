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
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { IPaymentServiceFactory } from '../../../payments/application/contracts/IPaymentServiceFactory'
import {
  AuthenticatedRequest,
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
@Security('BearerAuth')
@Security('ApiKeyAuth')
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
  @SuccessResponse('201', 'Partner user created')
  public async createPartnerUser(
    @Body() body: CreatePartnerUserRequest,
    @Request() req: AuthenticatedRequest,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<PartnerUserDto> {
    const validation = parsePayload(createPartnerUserSchema, body)
    if ('error' in validation) {
      return badRequest(400, { reason: validation.error })
    }

    const prisma = await this.dbProvider.getClient()

    try {
      const record = await prisma.partnerUser.create({
        data: {
          kycExternalToken: validation.data.kycExternalToken ?? null,
          partnerId: req.user.id,
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
  @SuccessResponse('200', 'Partner users retrieved')
  public async listPartnerUsers(
    @Query() page: number = 1,
    @Query() pageSize: number = DEFAULT_PAGE_SIZE,
    @Request() req: AuthenticatedRequest,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<PaginatedPartnerUsers> {
    const pagination = parsePagination({ page, pageSize })
    if ('error' in pagination) {
      return badRequest(400, { reason: pagination.error })
    }

    const prisma = await this.dbProvider.getClient()

    const [records, total] = await Promise.all([
      prisma.partnerUser.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (pagination.data.page - 1) * pagination.data.pageSize,
        take: pagination.data.pageSize,
        where: { partnerId: req.user.id },
      }),
      prisma.partnerUser.count({ where: { partnerId: req.user.id } }),
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
  @SuccessResponse('200', 'Partner user updated')
  public async updatePartnerUser(
    @Path() userId: string,
    @Body() body: UpdatePartnerUserRequest,
    @Request() req: AuthenticatedRequest,
    @Res() res: TsoaResponse<400 | 404, { reason: string }>,
  ): Promise<PartnerUserDto> {
    const validation = parsePayload(updatePartnerUserSchema, body)
    if ('error' in validation) {
      return res(400, { reason: validation.error })
    }

    const prisma = await this.dbProvider.getClient()

    try {
      const record = await prisma.partnerUser.update({
        data: validation.data,
        where: {
          partnerId_userId: {
            partnerId: req.user.id,
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
