// src/controllers/PartnerController.ts

import { Partner } from '@prisma/client'
import * as admin from 'firebase-admin'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Post,
  Res,
  Response,
  Route,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'
import { z } from 'zod'

import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { TYPES } from '../types'

const createPartnerRequestSchema = z.object({
  company: z.string().min(1),
  country: z.string().min(1),
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  password: z.string().min(8),
  phone: z.string().optional(),
})

export interface CreatePartnerRequest {
  company: string
  country: string
  email: string
  firstName: string
  lastName: string
  password: string
  phone: string
}

export interface CreatePartnerResponse {
  id: string
}

@Route('partner')
export class PartnerController extends Controller {
  constructor(
    @inject(TYPES.IDatabaseClientProvider) private dbProvider: IDatabaseClientProvider,
  ) {
    super()
  }

  /**
         * Create a new partner and Firebase user
         */
  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('201', 'Partner created')
  public async createPartner(
    @Body() body: CreatePartnerRequest,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<CreatePartnerResponse> {
    const parsedBody = createPartnerRequestSchema.safeParse(body)
    if (!parsedBody.success) {
      return badRequest(400, { reason: parsedBody.error.message })
    }
    const partnerData = parsedBody.data

    const dbClient = await this.dbProvider.getClient()

    let partner: Partner
    try {
      partner = await dbClient.partner.create({
        data: {
          country: partnerData.country,
          email: partnerData.email,
          firstName: partnerData.firstName,
          lastName: partnerData.lastName,
          name: partnerData.company,
          phone: partnerData.phone,
        },
      })
    }
    catch {
      return badRequest(400, { reason: 'Failed to create partner in the database' })
    }

    try {
      await admin.auth().createUser({
        displayName: partnerData.company,
        email: partnerData.email,
        password: partnerData.password,
        uid: partner.id,
      })
    }
    catch {
      return badRequest(400, { reason: 'Failed to create Firebase user' })
    }

    this.setStatus(201)
    return {
      id: partner.id,
    }
  }
}
