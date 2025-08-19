/**
 * PartnerUserController
 * ---------------------
 * HTTP boundary layer for Partner‑User resources.
 *
 * ▸ Strict Zod validation for all DTOs (but DTOs themselves are plain TS interfaces so TSOA can reflect them).
 * ▸ Clear HTTP semantics (201 for create, typed error responses, pagination constraints).
 * ▸ Controller remains thin; no domain/business logic leaks.
 * ▸ Zero `any` usage – all values are fully typed with Prisma models or utility types.
 */

import { type PartnerUser as PartnerUserModel, Prisma } from '@prisma/client'
import { Request as ExpressRequest } from 'express'
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
import { z, type ZodType } from 'zod'

import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { IPaymentServiceFactory } from '../interfaces/IPaymentServiceFactory'
import { TYPES } from '../types'

/** ------------------------------------------------------------------------
 * 🗒️  DTOs & Validation Schemas
 * --------------------------------------------------------------------- */

interface CreatePartnerUserRequest {
  kycExternalToken?: null | string
  userId: string
}

const createPartnerUserSchema: ZodType<CreatePartnerUserRequest> = z.object({
  kycExternalToken: z.string().min(1).nullable().optional(),
  kycToken: z.string().min(1).nullable().optional(),
  userId: z.string().uuid(),
})

interface PaginatedPartnerUsers {
  page: number
  pageSize: number
  total: number
  users: PartnerUserDto[]
}

interface PartnerUserDto {
  createdAt: Date
  id: string
  kycToken: null | string
  updatedAt: Date
  userId: string
}

interface UpdatePartnerUserRequest {
  kycExternalToken?: null | string
}

const updatePartnerUserSchema: ZodType<UpdatePartnerUserRequest> = z
  .object({
    kycExternalToken: z.string().min(1).nullable().optional(),
  })
  .refine(data => Object.keys(data).length > 0, {
    message: 'At least one field must be supplied',
  })

/**
 * Express request augmented with authenticated partner context.
 */
type AuthenticatedRequest = ExpressRequest & {
  user: { id: string }
}

/** ------------------------------------------------------------------------
 * 🚦  Controller
 * --------------------------------------------------------------------- */

@Route('partnerUser')
@Security('BearerAuth')
@Security('ApiKeyAuth')
export class PartnerUserController extends Controller {
  private static readonly DEFAULT_PAGE_SIZE = 20
  private static readonly MAX_PAGE_SIZE = 100

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
    const validation = createPartnerUserSchema.safeParse(body)
    if (!validation.success) {
      return badRequest(400, { reason: 'Invalid payload' })
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
    @Query() pageSize: number = PartnerUserController.DEFAULT_PAGE_SIZE,
    @Request() req: AuthenticatedRequest,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<PaginatedPartnerUsers> {
    if (
      page < 1
      || pageSize < 1
      || pageSize > PartnerUserController.MAX_PAGE_SIZE
    ) {
      return badRequest(400, { reason: 'Invalid pagination parameters' })
    }

    const prisma = await this.dbProvider.getClient()

    const [records, total] = await Promise.all([
      prisma.partnerUser.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        where: { partnerId: req.user.id },
      }),
      prisma.partnerUser.count({ where: { partnerId: req.user.id } }),
    ])

    return {
      page,
      pageSize,
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
    const validation = updatePartnerUserSchema.safeParse(body)
    if (!validation.success) {
      return res(400, { reason: validation.error.issues[0].message })
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
