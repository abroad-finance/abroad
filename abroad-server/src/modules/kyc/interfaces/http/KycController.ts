import { KycStatus } from '@prisma/client'
import { Request as RequestExpress } from 'express'
import { inject } from 'inversify'
import {
  Controller,
  FormField,
  Get,
  Post,
  Query,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
  UploadedFile,
} from 'tsoa'

import { TYPES } from '../../../../app/container/types'
import { requireAuthenticatedPartner } from '../../../../app/http/authenticationContext'
import { ValidationError } from '../../../../core/errors'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { KycSubmissionService } from '../../application/KycSubmissionService'
import { KycStatusResponse, kycSubmissionFormSchema, KycSubmitResponse, resolveDocumentExtension } from './kycContracts'

@Route('kyc')
export class KycController extends Controller {
  constructor(
    @inject(KycSubmissionService)
    private readonly kycSubmissionService: KycSubmissionService,
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
  ) {
    super()
  }

  /**
   * Current KYC status for a user. Lets the client decide whether to present the
   * verification form before an above-threshold transaction.
   */
  @Get('status')
  @Security('ApiKeyAuth', ['kyc:read'])
  @Security('BearerAuth')
  @SuccessResponse('200', 'KYC status retrieved')
  public async getKycStatus(
    @Request() request: RequestExpress,
    @Query() userId: string,
  ): Promise<KycStatusResponse> {
    const partner = requireAuthenticatedPartner(request.user)
    const prisma = await this.dbProvider.getClient()

    const partnerUser = await prisma.partnerUser.findUnique({
      select: { id: true },
      where: {
        partnerId_userId: { partnerId: String(partner.id), userId },
      },
    })
    if (!partnerUser) {
      return { hasApproved: false, status: null }
    }

    const latest = await prisma.partnerUserKyc.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { status: true },
      where: { partnerUserId: partnerUser.id },
    })

    return {
      hasApproved: latest?.status === KycStatus.APPROVED,
      status: latest?.status ?? null,
    }
  }

  /**
   * Submit the self-service KYC form (multipart: identity fields + document
   * image). A complete submission is auto-approved.
   */
  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('ApiKeyAuth', ['kyc:write'])
  @Security('BearerAuth')
  @SuccessResponse('201', 'KYC submitted')
  public async submitKyc(
    @Request() request: RequestExpress,
    @UploadedFile() document: Express.Multer.File,
    @FormField() userId: string,
    @FormField() fullName: string,
    @FormField() documentType: string,
    @FormField() documentNumber: string,
    @FormField() dateOfBirth: string,
    @FormField() nationality: string,
    @FormField() city: string,
    @FormField() address: string,
    @FormField() email: string,
    @FormField() phone: string,
  ): Promise<KycSubmitResponse> {
    const partner = requireAuthenticatedPartner(request.user)

    if (!document) {
      throw new ValidationError('Document image is required')
    }
    const fileExtension = resolveDocumentExtension(document.mimetype)
    if (!fileExtension) {
      throw new ValidationError('Unsupported document image type')
    }

    const parsed = kycSubmissionFormSchema.safeParse({
      address,
      city,
      dateOfBirth,
      documentNumber,
      documentType,
      email,
      fullName,
      nationality,
      phone,
      userId,
    })
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid KYC submission')
    }

    const result = await this.kycSubmissionService.submit({
      address: parsed.data.address,
      city: parsed.data.city,
      dateOfBirth: parsed.data.dateOfBirth,
      document: {
        buffer: document.buffer,
        contentType: document.mimetype,
        fileExtension,
      },
      documentNumber: parsed.data.documentNumber,
      documentType: parsed.data.documentType,
      email: parsed.data.email,
      fullName: parsed.data.fullName,
      nationality: parsed.data.nationality,
      partnerId: String(partner.id),
      phone: parsed.data.phone,
      userId: parsed.data.userId,
    })

    this.setStatus(201)
    return { status: result.status }
  }
}
