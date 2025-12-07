import 'reflect-metadata'
import type { TsoaResponse } from '@tsoa/runtime'
import type { Partner } from '@prisma/client'

import * as admin from 'firebase-admin'

import type { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'

import { PartnerController } from '../../controllers/PartnerController'

type PartnerCreateInput = {
  country: string
  email: string
  firstName: string
  lastName: string
  name: string
  phone?: string
}

type PartnerModel = PartnerCreateInput & {
  createdAt: Date
  id: string
  isKybApproved: boolean
  needsKyc: boolean
}

const buildDbProvider = (overrides?: Partial<PartnerModel>) => {
  const partnerCreate = jest.fn(async (data: { data: PartnerCreateInput }): Promise<PartnerModel> => ({
    ...data.data,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    id: 'partner-1',
    isKybApproved: false,
    needsKyc: true,
    ...(overrides ?? {}),
  }))

  const prisma = {
    partner: {
      create: partnerCreate,
    },
  }

  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  }

  return { dbProvider, partnerCreate }
}

const setupTsoaResponses = () => {
  const badRequest: TsoaResponse<400, { reason: string }> = jest.fn(
    (_status: 400, payload: { reason: string }) => payload,
  )
  const created: TsoaResponse<201, { id: string }> = jest.fn(
    (_status: 201, payload: { id: string }) => payload,
  )
  return { badRequest, created }
}

describe('PartnerController', () => {
  const createUser = jest.fn()

  beforeEach(() => {
    jest.resetAllMocks()
    jest.spyOn(admin, 'auth').mockReturnValue({ createUser } as unknown as admin.auth.Auth)
  })

  it('rejects invalid payloads with a 400', async () => {
    const { badRequest, created } = setupTsoaResponses()
    const { dbProvider } = buildDbProvider()
    const controller = new PartnerController(dbProvider)

    const response = await controller.createPartner(
      // missing required fields
      { company: '', country: '', email: 'bad-email', firstName: '', lastName: '', password: '', phone: '' },
      badRequest,
      created,
    )

    expect(badRequest).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ reason: expect.any(String) }))
    expect(created).not.toHaveBeenCalled()
    expect(response).toEqual(expect.objectContaining({ reason: expect.any(String) }))
  })

  it('handles database failures gracefully', async () => {
    const { badRequest, created } = setupTsoaResponses()
    const { dbProvider, partnerCreate } = buildDbProvider()
    partnerCreate.mockRejectedValueOnce(new Error('db down'))
    const controller = new PartnerController(dbProvider)

    const response = await controller.createPartner(
      {
        company: 'Acme',
        country: 'CO',
        email: 'acme@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        password: 'supersecret',
        phone: '123',
      },
      badRequest,
      created,
    )

    expect(response).toEqual({ reason: 'Failed to create partner in the database' })
    expect(created).not.toHaveBeenCalled()
  })

  it('returns a 400 when firebase user creation fails', async () => {
    const { badRequest, created } = setupTsoaResponses()
    const { dbProvider } = buildDbProvider()
    createUser.mockRejectedValueOnce(new Error('firebase down'))
    const controller = new PartnerController(dbProvider)

    const response = await controller.createPartner(
      {
        company: 'Acme',
        country: 'CO',
        email: 'acme@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        password: 'supersecret',
        phone: '123',
      },
      badRequest,
      created,
    )

    expect(response).toEqual({ reason: 'Failed to create Firebase user' })
    expect(created).not.toHaveBeenCalled()
  })

  it('creates the partner and returns the id on success', async () => {
    const { badRequest, created } = setupTsoaResponses()
    const { dbProvider, partnerCreate } = buildDbProvider({ id: 'partner-123' })
    createUser.mockResolvedValueOnce(undefined as unknown as admin.auth.UserRecord)
    const controller = new PartnerController(dbProvider)

    const response = await controller.createPartner(
      {
        company: 'Acme',
        country: 'CO',
        email: 'acme@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        password: 'supersecret',
        phone: '123',
      },
      badRequest,
      created,
    )

    expect(badRequest).not.toHaveBeenCalled()
    expect(created).toHaveBeenCalledWith(201, { id: 'partner-123' })
    expect(partnerCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        country: 'CO',
        email: 'acme@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        name: 'Acme',
        phone: '123',
      }),
    })
    expect(response).toEqual({ id: 'partner-123' })
  })

  it('maps the authenticated partner to a response DTO', async () => {
    const controller = new PartnerController(buildDbProvider().dbProvider)
    const partner = {
      country: 'CO',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      email: 'partner@example.com',
      firstName: 'Pat',
      id: 'partner-abc',
      isKybApproved: true,
      lastName: 'Ner',
      name: 'Partner Inc.',
      needsKyc: false,
      phone: '555-1234',
    }

    const response = await controller.getPartnerInfo({ user: partner } as unknown as import('express').Request)

    expect(response).toEqual({
      country: 'CO',
      createdAt: partner.createdAt,
      email: partner.email,
      firstName: partner.firstName,
      id: partner.id,
      isKybApproved: true,
      lastName: partner.lastName,
      name: partner.name,
      needsKyc: false,
      phone: partner.phone,
    })
  })

  it('defaults nullable partner fields when they are not set', async () => {
    const controller = new PartnerController(buildDbProvider().dbProvider)
    const partner: Partner = {
      apiKey: null,
      country: null,
      createdAt: new Date('2024-02-02T00:00:00.000Z'),
      email: null,
      firstName: null,
      id: 'partner-null',
      isKybApproved: null,
      lastName: null,
      name: 'Fallback Corp',
      needsKyc: null,
      phone: null,
      webhookUrl: null,
    }

    const response = await controller.getPartnerInfo({ user: partner } as unknown as import('express').Request)

    expect(response).toEqual({
      country: undefined,
      createdAt: partner.createdAt,
      email: undefined,
      firstName: undefined,
      id: partner.id,
      isKybApproved: false,
      lastName: undefined,
      name: partner.name,
      needsKyc: false,
      phone: undefined,
    })
  })
})
