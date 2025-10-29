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
  idNumber?: string
  phone?: string
}

// (intentionally not using a flattening approach; we consume exact Persona keys)

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

      console.log(JSON.stringify(data))

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

  private buildFullNameFromAttributes(attrs?: Record<string, unknown>): string | undefined {
    if (!attrs) return undefined
    const first = typeof attrs['name-first'] === 'string' ? String(attrs['name-first']).trim() : ''
    const middle = typeof attrs['name-middle'] === 'string' ? String(attrs['name-middle']).trim() : ''
    const last = typeof attrs['name-last'] === 'string' ? String(attrs['name-last']).trim() : ''
    const parts = [first, middle, last].filter(p => p && p.length > 0)
    return parts.length > 0 ? parts.join(' ') : undefined
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

  // Helper to read Persona fields.<key>.value from inquiry.attributes.fields
  private getFieldValue<T = unknown>(
    fields: Record<string, unknown> | undefined,
    key: string,
  ): T | undefined {
    if (!fields) return undefined
    const entry = fields[key]
    if (!entry || typeof entry !== 'object') return undefined
    const value = (entry as Record<string, unknown>).value as T | undefined
    return value === null ? undefined : value
  }

  private mapDocumentClassToLabel(code: string | undefined, country?: string): string | undefined {
    if (!code) return undefined
    const normalized = code.toLowerCase()

    // Normalized country for localization tweaks
    const c = typeof country === 'string' ? country.toUpperCase() : undefined

    // Common codes and their readable Spanish labels
    const table: Record<string, string> = {
      dl: 'Licencia de conducción',
      driver_license: 'Licencia de conducción',
      drivers_license: 'Licencia de conducción',
      id: c === 'CO' ? 'Cédula de ciudadanía' : 'Documento de identidad',
      id_card: c === 'CO' ? 'Cédula de ciudadanía' : 'Documento de identidad',
      national_id: c === 'CO' ? 'Cédula de ciudadanía' : 'Documento de identidad',
      passport: 'Pasaporte',
      pp: 'Pasaporte',
      residence_permit: 'Permiso de residencia',
      rp: 'Permiso de residencia',
      visa: 'Visa',
    }

    return table[normalized] ?? code
  }

  private parseInquiryPayload(payload: unknown): null | PersonaInquiryDetails {
    if (!payload || typeof payload !== 'object') return null

    const container = this.extractPrimaryResource(payload as Record<string, unknown>)
    if (!container) return null

    const { included, resource } = container

    // Include Government ID document attributes (type is e.g. 'document/government-id')
    const documentsAttributes = included
      .filter(item => typeof item.type === 'string' && String(item.type).startsWith('document'))
      .map(item => (item.attributes ?? {})) as Array<Record<string, unknown>>

    const resourceAttributesRaw = resource.attributes
    const resourceAttributes = resourceAttributesRaw && typeof resourceAttributesRaw === 'object'
      ? resourceAttributesRaw as Record<string, unknown>
      : undefined

    const resourceFields = resourceAttributes && typeof resourceAttributes.fields === 'object'
      ? (resourceAttributes.fields as Record<string, unknown>)
      : undefined

    // Exact keys from Persona API response (kebab-case)
    let fullName = this.buildFullNameFromAttributes(resourceAttributes)

    const documentAttrs = documentsAttributes[0] ?? {}
    const documentClass = this.getFieldValue<string>(resourceFields, 'identification-class')
      ?? (typeof documentAttrs['id-class'] === 'string' ? String(documentAttrs['id-class']) : undefined)
    if (!fullName) {
      fullName = this.buildFullNameFromAttributes(documentAttrs)
    }

    const addressLine1 = typeof resourceAttributes?.['address-street-1'] === 'string'
      ? String(resourceAttributes['address-street-1'])
      : undefined
    const addressLine2 = typeof resourceAttributes?.['address-street-2'] === 'string'
      ? String(resourceAttributes['address-street-2'])
      : undefined
    const city = typeof resourceAttributes?.['address-city'] === 'string'
      ? String(resourceAttributes['address-city'])
      : undefined
    const department = typeof resourceAttributes?.['address-subdivision'] === 'string'
      ? String(resourceAttributes['address-subdivision'])
      : undefined
    const country = this.getFieldValue<string>(resourceFields, 'selected-country-code')
      ?? (typeof resourceAttributes?.['address-country-code'] === 'string' ? String(resourceAttributes['address-country-code']) : undefined)

    const address = [addressLine1, addressLine2].filter(Boolean).join(', ')

    // Determine the correct ID number to show
    const attrIdNumber = typeof resourceAttributes?.['identification-number'] === 'string'
      ? String(resourceAttributes['identification-number'])
      : this.getFieldValue<string>(resourceFields, 'identification-number')
    const documentNumber = typeof documentAttrs['document-number'] === 'string'
      ? String(documentAttrs['document-number'])
      : undefined
    const docIdentificationNumber = typeof documentAttrs['identification-number'] === 'string'
      ? String(documentAttrs['identification-number'])
      : undefined

    const idNumber = (documentClass === 'pp' ? documentNumber : (attrIdNumber ?? docIdentificationNumber))
      ?? attrIdNumber

    const email = typeof resourceAttributes?.['email-address'] === 'string'
      ? String(resourceAttributes['email-address'])
      : this.getFieldValue<string>(resourceFields, 'email-address')
    const phone = typeof resourceAttributes?.['phone-number'] === 'string'
      ? String(resourceAttributes['phone-number'])
      : this.getFieldValue<string>(resourceFields, 'phone-number')

    const documentType = this.mapDocumentClassToLabel(documentClass, country)

    return {
      address: address || undefined,
      city,
      country,
      department,
      documentType,
      email: email ?? undefined,
      fullName,
      idNumber: idNumber ?? undefined,
      phone: phone ?? undefined,
    }
  }
}
