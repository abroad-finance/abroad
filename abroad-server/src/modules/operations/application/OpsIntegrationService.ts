import type { Prisma } from '@prisma/client'

import { OpsIntegrationKind, OpsIntegrationStatus, Prisma as PrismaNamespace } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ApplicationError } from '../../../core/errors'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { OpsUserPrincipal, requireOpsPermission } from './opsIdentity'

const MAX_DESCRIPTION = 1_000
const MAX_EVENTS = 30
const MAX_EVENT_LENGTH = 80
const MAX_LABEL = 120
const MAX_NAME = 120
const MAX_KINDS = 30
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SECRET_LIKE_PATTERN = /(secret|token|password|credential|api.?key|bearer)/i
const URL_LIKE_PATTERN = /(?:https?:\/\/|@[^\s]+\.[a-z]{2,})/i

export type OpsIntegrationCatalogDto = {
  integrations: OpsIntegrationDto[]
  runbooks: OpsRunbookDto[]
}

type OpsIntegrationConfigurationInput = {
  destinationLabel?: null | string
  eventKinds?: string[]
  healthcheckName?: null | string
  provider?: null | string
}

export type OpsIntegrationDto = {
  configuration: OpsIntegrationConfigurationInput
  createdAt: Date
  description: string
  id: string
  kind: OpsIntegrationKind
  lastCheckedAt: Date | null
  lastErrorCode: null | string
  name: string
  status: OpsIntegrationStatus
  updatedAt: Date
  version: number
}

export type OpsIntegrationInput = {
  configuration: OpsIntegrationConfigurationInput
  description: string
  kind: OpsIntegrationKind
  name: string
  status: OpsIntegrationStatus
}

export type OpsRunbookDto = {
  active: boolean
  createdAt: Date
  description: string
  id: string
  incidentKinds: string[]
  name: string
  slug: string
  updatedAt: Date
  url: string
  version: number
}

export type OpsRunbookInput = {
  active: boolean
  description: string
  incidentKinds: string[]
  name: string
  slug: string
  url: string
}

class OpsIntegrationConflictError extends ApplicationError {
  public constructor(message = 'This integration changed after it was loaded; refresh before trying again') {
    super(409, 'ops_integration_conflict', message)
    this.name = 'OpsIntegrationConflictError'
  }
}

class OpsIntegrationNotFoundError extends ApplicationError {
  public constructor(resource = 'Integration') {
    super(404, 'ops_integration_not_found', `${resource} not found`)
    this.name = 'OpsIntegrationNotFoundError'
  }
}

export class OpsIntegrationValidationError extends ApplicationError {
  public constructor(message: string) {
    super(400, 'ops_integration_invalid', message)
    this.name = 'OpsIntegrationValidationError'
  }
}

@injectable()
export class OpsIntegrationService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async createIntegration(
    principal: OpsUserPrincipal,
    input: OpsIntegrationInput,
    transaction: Prisma.TransactionClient,
  ): Promise<OpsIntegrationDto> {
    requireOpsPermission(principal, 'administration:integrations')
    const normalized = this.validateIntegration(input)
    try {
      const row = await transaction.opsIntegration.create({
        data: {
          ...normalized,
          configuration: this.serializeConfiguration(normalized.configuration),
          createdByUserId: principal.userId,
          updatedByUserId: principal.userId,
        },
      })
      return this.toIntegrationDto(row)
    }
    catch (error) {
      if (error instanceof PrismaNamespace.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new OpsIntegrationConflictError('An integration with this name already exists')
      }
      throw error
    }
  }

  public async createRunbook(
    principal: OpsUserPrincipal,
    input: OpsRunbookInput,
    transaction: Prisma.TransactionClient,
  ): Promise<OpsRunbookDto> {
    requireOpsPermission(principal, 'administration:integrations')
    const normalized = this.validateRunbook(input)
    try {
      return await transaction.opsRunbook.create({
        data: {
          ...normalized,
          createdByUserId: principal.userId,
          updatedByUserId: principal.userId,
        },
        select: this.runbookSelect(),
      })
    }
    catch (error) {
      if (error instanceof PrismaNamespace.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new OpsIntegrationConflictError('A runbook with this slug already exists')
      }
      throw error
    }
  }

  public async getCatalog(principal: OpsUserPrincipal): Promise<OpsIntegrationCatalogDto> {
    requireOpsPermission(principal, 'incidents:read')
    const client = await this.databaseClientProvider.getClient()
    const [integrations, runbooks] = await Promise.all([
      client.opsIntegration.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] }),
      client.opsRunbook.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }], select: this.runbookSelect() }),
    ])
    return {
      integrations: integrations.map(row => this.toIntegrationDto(row)),
      runbooks,
    }
  }

  public async updateIntegration(
    principal: OpsUserPrincipal,
    integrationId: string,
    input: OpsIntegrationInput,
    expectedVersion: number,
    transaction: Prisma.TransactionClient,
  ): Promise<OpsIntegrationDto> {
    requireOpsPermission(principal, 'administration:integrations')
    this.validateVersion(expectedVersion)
    const normalized = this.validateIntegration(input)
    const result = await transaction.opsIntegration.updateMany({
      data: {
        ...normalized,
        configuration: this.serializeConfiguration(normalized.configuration),
        updatedByUserId: principal.userId,
        version: { increment: 1 },
      },
      where: { id: integrationId, version: expectedVersion },
    })
    if (result.count !== 1) await this.throwConflictOrNotFound(transaction, 'integration', integrationId)
    const row = await transaction.opsIntegration.findUnique({ where: { id: integrationId } })
    if (!row) throw new OpsIntegrationNotFoundError()
    return this.toIntegrationDto(row)
  }

  public async updateRunbook(
    principal: OpsUserPrincipal,
    runbookId: string,
    input: OpsRunbookInput,
    expectedVersion: number,
    transaction: Prisma.TransactionClient,
  ): Promise<OpsRunbookDto> {
    requireOpsPermission(principal, 'administration:integrations')
    this.validateVersion(expectedVersion)
    const normalized = this.validateRunbook(input)
    const result = await transaction.opsRunbook.updateMany({
      data: {
        ...normalized,
        updatedByUserId: principal.userId,
        version: { increment: 1 },
      },
      where: { id: runbookId, version: expectedVersion },
    })
    if (result.count !== 1) await this.throwConflictOrNotFound(transaction, 'runbook', runbookId)
    const row = await transaction.opsRunbook.findUnique({
      select: this.runbookSelect(),
      where: { id: runbookId },
    })
    if (!row) throw new OpsIntegrationNotFoundError('Runbook')
    return row
  }

  private normalizeSafeLabel(value: null | string | undefined, label: string): null | string {
    const normalized = value?.trim() || null
    if (!normalized) return null
    if (normalized.length > MAX_LABEL) {
      throw new OpsIntegrationValidationError(`${label} must be at most ${MAX_LABEL} characters`)
    }
    if (SECRET_LIKE_PATTERN.test(normalized) || URL_LIKE_PATTERN.test(normalized)) {
      throw new OpsIntegrationValidationError(`${label} must be a public alias, not a URL or credential`)
    }
    return normalized
  }

  private parseConfiguration(value: Prisma.JsonValue): OpsIntegrationConfigurationInput {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const stringValue = (key: string): null | string => {
      const candidate = value[key]
      return typeof candidate === 'string' ? candidate : null
    }
    return {
      destinationLabel: stringValue('destinationLabel'),
      eventKinds: Array.isArray(value.eventKinds)
        ? value.eventKinds.filter((entry): entry is string => typeof entry === 'string').slice(0, MAX_EVENTS)
        : [],
      healthcheckName: stringValue('healthcheckName'),
      provider: stringValue('provider'),
    }
  }

  private runbookSelect() {
    return {
      active: true,
      createdAt: true,
      description: true,
      id: true,
      incidentKinds: true,
      name: true,
      slug: true,
      updatedAt: true,
      url: true,
      version: true,
    } as const
  }

  private serializeConfiguration(configuration: OpsIntegrationConfigurationInput): Prisma.InputJsonObject {
    return {
      destinationLabel: configuration.destinationLabel ?? null,
      eventKinds: configuration.eventKinds ?? [],
      healthcheckName: configuration.healthcheckName ?? null,
      provider: configuration.provider ?? null,
    }
  }

  private async throwConflictOrNotFound(
    transaction: Prisma.TransactionClient,
    resource: 'integration' | 'runbook',
    id: string,
  ): Promise<never> {
    const exists = resource === 'integration'
      ? await transaction.opsIntegration.findUnique({ select: { id: true }, where: { id } })
      : await transaction.opsRunbook.findUnique({ select: { id: true }, where: { id } })
    if (!exists) throw new OpsIntegrationNotFoundError(resource === 'integration' ? 'Integration' : 'Runbook')
    throw new OpsIntegrationConflictError()
  }

  private toIntegrationDto(row: {
    configuration: Prisma.JsonValue
    createdAt: Date
    description: string
    id: string
    kind: OpsIntegrationKind
    lastCheckedAt: Date | null
    lastErrorCode: null | string
    name: string
    status: OpsIntegrationStatus
    updatedAt: Date
    version: number
  }): OpsIntegrationDto {
    return {
      configuration: this.parseConfiguration(row.configuration),
      createdAt: row.createdAt,
      description: row.description,
      id: row.id,
      kind: row.kind,
      lastCheckedAt: row.lastCheckedAt,
      lastErrorCode: row.lastErrorCode,
      name: row.name,
      status: row.status,
      updatedAt: row.updatedAt,
      version: row.version,
    }
  }

  private validateIntegration(input: OpsIntegrationInput): OpsIntegrationInput {
    const name = input.name.trim()
    const description = input.description.trim()
    if (!name || name.length > MAX_NAME) {
      throw new OpsIntegrationValidationError(`Integration name must be between 1 and ${MAX_NAME} characters`)
    }
    if (!description || description.length > MAX_DESCRIPTION) {
      throw new OpsIntegrationValidationError(`Integration description must be between 1 and ${MAX_DESCRIPTION} characters`)
    }
    const eventKinds = [...new Set((input.configuration.eventKinds ?? []).map(value => value.trim()).filter(Boolean))]
    if (eventKinds.length > MAX_EVENTS || eventKinds.some(value => value.length > MAX_EVENT_LENGTH || SECRET_LIKE_PATTERN.test(value))) {
      throw new OpsIntegrationValidationError('Event categories must be short public operational labels')
    }
    return {
      configuration: {
        destinationLabel: this.normalizeSafeLabel(input.configuration.destinationLabel, 'Destination label'),
        eventKinds,
        healthcheckName: this.normalizeSafeLabel(input.configuration.healthcheckName, 'Healthcheck name'),
        provider: this.normalizeSafeLabel(input.configuration.provider, 'Provider'),
      },
      description,
      kind: input.kind,
      name,
      status: input.status,
    }
  }

  private validateRunbook(input: OpsRunbookInput): OpsRunbookInput {
    const name = input.name.trim()
    const slug = input.slug.trim().toLowerCase()
    const description = input.description.trim()
    if (!name || name.length > MAX_NAME) throw new OpsIntegrationValidationError('Runbook name is required')
    if (!SLUG_PATTERN.test(slug) || slug.length > 100) {
      throw new OpsIntegrationValidationError('Runbook slug must use lowercase words separated by hyphens')
    }
    if (!description || description.length > MAX_DESCRIPTION) {
      throw new OpsIntegrationValidationError(`Runbook description must be between 1 and ${MAX_DESCRIPTION} characters`)
    }
    let parsedUrl: URL
    try {
      parsedUrl = new URL(input.url.trim())
    }
    catch {
      throw new OpsIntegrationValidationError('Runbook URL must be a valid HTTPS URL')
    }
    if (
      parsedUrl.protocol !== 'https:'
      || parsedUrl.username
      || parsedUrl.password
      || parsedUrl.search
      || parsedUrl.hash
    ) {
      throw new OpsIntegrationValidationError('Runbook URL must be HTTPS and contain no credentials, query, or fragment')
    }
    const incidentKinds = [...new Set(input.incidentKinds.map(value => value.trim().toUpperCase()).filter(Boolean))]
    if (incidentKinds.length === 0 || incidentKinds.length > MAX_KINDS || incidentKinds.some(value => !/^[A-Z0-9_]{2,60}$/.test(value))) {
      throw new OpsIntegrationValidationError('Select between 1 and 30 valid incident kinds')
    }
    return {
      active: input.active,
      description,
      incidentKinds,
      name,
      slug,
      url: parsedUrl.toString(),
    }
  }

  private validateVersion(version: number): void {
    if (!Number.isInteger(version) || version < 1) {
      throw new OpsIntegrationValidationError('The current resource version is required')
    }
  }
}
