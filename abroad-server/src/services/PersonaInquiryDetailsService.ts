import axios, { AxiosInstance } from 'axios'

import type { ISecretManager } from '../interfaces/ISecretManager'

export type PersonaInquiryDetails = {
  address?: string
  city?: string
  country?: string
  department?: string
  documentType?: string
  email?: string
  fullName?: string
  phone?: string
}

type FlatRecord = Record<string, unknown>

/**
 * Fetches Persona inquiry details and normalises common personal-data fields so they can be
 * displayed in the Admin panel regardless of the exact schema version configured in Persona.
 *
 * Persona's REST API exposes most user attributes under the `fields` object, using either
 * kebab-case (`address-city`) or snake_case (`address_city`). We flatten those keys and keep
 * a tiny cache to avoid hitting the API repeatedly while an admin paginates through the list.
 */
export class PersonaInquiryDetailsService {
  private axiosClient?: AxiosInstance

  private readonly cache = new Map<string, null | PersonaInquiryDetails>()

  constructor(private readonly secretManager: ISecretManager) {}

  public async getDetails(inquiryId: string): Promise<null | PersonaInquiryDetails> {
    if (!inquiryId) return null

    if (this.cache.has(inquiryId)) {
      return this.cache.get(inquiryId) ?? null
    }

    try {
      const client = await this.ensureClient()

      const { data } = await client.get(`/inquiries/${encodeURIComponent(inquiryId)}`, {
        params: { include: 'account,documents' },
      })

      const details = this.parseInquiryPayload(data)
      this.cache.set(inquiryId, details)
      return details
    }
    catch (error) {
      console.error('Failed to fetch Persona inquiry details', { error, inquiryId })
      this.cache.set(inquiryId, null)
      return null
    }
  }

  private buildFullName(source: FlatRecord): string | undefined {
    const first = this.pickString(source, ['name-first', 'name_first', 'first_name'])
    const last = this.pickString(source, ['name-last', 'name_last', 'last_name'])

    const parts = [first, last].filter(Boolean)
    if (parts.length === 0) return undefined
    return parts.join(' ')
  }

  private combineFields(...sources: Array<unknown>): FlatRecord {
    return sources.reduce<FlatRecord>((acc, source) => {
      if (!source) return acc
      const flattened = this.flattenFields(source)
      for (const [key, value] of Object.entries(flattened)) {
        if (
          !acc[key]
          || acc[key] === null
          || acc[key] === undefined
        ) {
          acc[key] = value
        }
      }
      return acc
    }, {})
  }

  private async ensureClient(): Promise<AxiosInstance> {
    if (this.axiosClient) return this.axiosClient

    const { PERSONA_API_KEY } = await this.secretManager.getSecrets([
      'PERSONA_API_KEY',
    ] as const)

    this.axiosClient = axios.create({
      baseURL: 'https://withpersona.com/api/v1',
      headers: {
        'Authorization': `Bearer ${PERSONA_API_KEY}`,
        'Content-Type': 'application/json',
        // Explicit version header keeps payload shape stable
        'Persona-Version': '2023-01-01',
      },
      timeout: 10_000,
    })

    return this.axiosClient
  }

  private extractPrimaryResource(payload: Record<string, unknown>): null | {
    included: Array<Record<string, unknown>>
    resource: Record<string, unknown>
  } {
    const included: Array<Record<string, unknown>> = []
    const seen = new Set<unknown>()

    const collectIncluded = (value: unknown) => {
      if (!value || !Array.isArray(value)) return
      for (const entry of value) {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          included.push(entry as Record<string, unknown>)
        }
      }
    }

    const unwrap = (value: unknown): null | Record<string, unknown> => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null
      if (seen.has(value)) return null
      seen.add(value)

      const record = value as Record<string, unknown>
      collectIncluded(record.included)

      const inner = record.data
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        return unwrap(inner)
      }

      return record
    }

    collectIncluded(payload.included)
    let resource = unwrap(payload.data)
    if (!resource) {
      resource = unwrap(payload)
    }
    if (!resource) return null

    collectIncluded(resource.included)

    return { included, resource }
  }

  private extractRelationship(
    relationship: unknown,
  ): null | { id: string, type?: string } {
    if (!relationship || typeof relationship !== 'object') return null
    const data = (relationship as Record<string, unknown>).data
    if (!data || typeof data !== 'object') return null
    const id = (data as Record<string, unknown>).id
    if (typeof id !== 'string' || !id.trim()) return null
    const type = (data as Record<string, unknown>).type
    return { id, type: typeof type === 'string' ? type : undefined }
  }

  private findIncludedAttributes(
    included: Array<Record<string, unknown>>,
    type: string,
    id: string,
  ): null | Record<string, unknown> {
    const match = included.find(
      item => item.type === type && item.id === id,
    )
    if (!match) return null
    const attrs = match.attributes
    return attrs && typeof attrs === 'object' ? (attrs as Record<string, unknown>) : null
  }

  private flattenFields(source: unknown): FlatRecord {
    const result: FlatRecord = {}

    const walk = (value: unknown): void => {
      if (!value || typeof value !== 'object') return

      for (const [rawKey, rawVal] of Object.entries(value as Record<string, unknown>)) {
        const normalizedKey = this.normalizeKey(rawKey)

        if (Array.isArray(rawVal)) {
          rawVal.forEach(item => walk(item))
        }
        else if (rawVal && typeof rawVal === 'object') {
          walk(rawVal)
        }

        const existing = result[normalizedKey]
        const shouldOverwrite
          = !Object.prototype.hasOwnProperty.call(result, normalizedKey)
            || existing === null
            || existing === undefined
            || (typeof existing === 'string' && existing.trim() === '')

        if (shouldOverwrite) {
          result[normalizedKey] = rawVal
        }
      }
    }

    walk(source)
    return result
  }

  private normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '')
  }

  private parseInquiryPayload(payload: unknown): null | PersonaInquiryDetails {
    if (!payload || typeof payload !== 'object') return null

    const container = this.extractPrimaryResource(payload as Record<string, unknown>)
    if (!container) return null

    const { included, resource } = container
    const relationships = resource.relationships

    let accountId: string | undefined
    if (relationships && typeof relationships === 'object') {
      const accountData = (relationships as Record<string, unknown>).account
      const accountRelationship = this.extractRelationship(accountData)
      accountId = accountRelationship?.id
    }

    const accountAttributes = accountId
      ? this.findIncludedAttributes(included, 'account', accountId)
      : null

    const documentsAttributes = included
      .filter(item => item.type === 'document')
      .map(item => (item.attributes ?? {})) as Array<Record<string, unknown>>

    const resourceAttributesRaw = resource.attributes
    const resourceAttributes = resourceAttributesRaw && typeof resourceAttributesRaw === 'object'
      ? resourceAttributesRaw as Record<string, unknown>
      : undefined

    const resourceFieldsValue = resourceAttributes
      ? (resourceAttributes as Record<string, unknown>)['fields']
      : undefined
    const resourceFields = resourceFieldsValue && typeof resourceFieldsValue === 'object'
      ? resourceFieldsValue as Record<string, unknown>
      : undefined

    const accountFieldsValue = accountAttributes
      ? (accountAttributes as Record<string, unknown>)['fields']
      : undefined
    const accountFields = accountFieldsValue && typeof accountFieldsValue === 'object'
      ? accountFieldsValue as Record<string, unknown>
      : undefined

    const fieldsSource = this.combineFields(
      resourceAttributes,
      resourceFields,
      accountAttributes,
      accountFields,
    )

    const fullName = this.pickString(fieldsSource, [
      'name-full',
      'name_full',
      'full_name',
      'fullname',
      'legal_name',
    ]) ?? this.buildFullName(fieldsSource)

    const documentAttributes = this.combineFields(...documentsAttributes)
    const documentType = this.pickString(documentAttributes, [
      'document-type',
      'document_type',
      'government-id-type',
      'government_id_type',
      'id-class',
      'id_class',
    ]) ?? this.pickString(fieldsSource, [
      'government-id-type',
      'government_id_type',
      'document-type',
      'document_type',
      'identification-class',
      'identification_class',
      'id-class',
      'id_class',
    ])

    const addressLine1 = this.pickString(fieldsSource, [
      'address-street-1',
      'address_street_1',
      'address-line-1',
      'address_line_1',
      'address',
      'street_1',
    ])
    const addressLine2 = this.pickString(fieldsSource, [
      'address-street-2',
      'address_street_2',
      'address-line-2',
      'address_line_2',
      'address-secondary',
      'address_secondary',
      'street_2',
    ])
    const city = this.pickString(fieldsSource, [
      'address-city',
      'address_city',
      'city',
      'municipality',
    ])
    const department = this.pickString(fieldsSource, [
      'address-subdivision',
      'address_subdivision',
      'state',
      'region',
      'department',
      'subdivision',
    ])
    const country = this.pickString(fieldsSource, [
      'address-country-code',
      'address_country_code',
      'country',
      'country-code',
      'country_code',
      'selected-country-code',
      'selected_country_code',
    ])

    const address = [addressLine1, addressLine2].filter(Boolean).join(', ')

    return {
      address: address || undefined,
      city,
      country,
      department,
      documentType,
      email: this.pickString(fieldsSource, ['email-address', 'email_address', 'email']),
      fullName,
      phone: this.pickString(fieldsSource, ['phone-number', 'phone_number', 'phone']),
    }
  }

  private pickString(
    source: FlatRecord,
    candidateKeys: string[],
  ): string | undefined {
    for (const key of candidateKeys) {
      const normalized = this.normalizeKey(key)
      const value = source[normalized]
      const extracted = this.toStringValue(value)
      if (extracted) return extracted
    }
    return undefined
  }

  private toStringValue(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : undefined
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const str = this.toStringValue(item)
        if (str) return str
      }
      return undefined
    }
    if (value && typeof value === 'object') {
      const candidateKeys = ['value', 'label', 'name', 'display']
      for (const key of candidateKeys) {
        const nested = (value as Record<string, unknown>)[key]
        const str = this.toStringValue(nested)
        if (str) return str
      }
    }
    return undefined
  }
}
