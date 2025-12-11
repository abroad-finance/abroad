import axios, { AxiosInstance } from 'axios'

import type { ILogger } from '../interfaces'
import type { ISecretManager } from '../interfaces/ISecretManager'

import { ConsoleLogger } from './consoleLogger'

/**
 * Normalized subset of personal data extracted from a Persona inquiry.
 * This shape is stable for the Admin UI regardless of Persona template versions.
 */
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

/** Minimal JSON object helper type (keeps us honest with unknown payloads) */
type JsonRecord = Record<string, unknown>

/**
 * Service that fetches a Persona inquiry and normalizes a small set of personal-data fields.
 *
 * Persona's REST API generally follows a JSON:API shape where most user attributes are under
 * the `attributes` object and dynamic form values are under `attributes.fields.<key>.value`.
 *
 * This service flattens and normalizes those values for Admin consumption. A tiny in-memory
 * cache avoids refetching as an admin paginates through inquiries.
 *
 * @example
 * const svc = new PersonaInquiryDetailsService(secretManager, { debug: false })
 * const details = await svc.getDetails('inq_123...')
 * // details -> { fullName, email, phone, address, city, department, country, idNumber, documentType }
 */
export class PersonaInquiryDetailsService {
  /** Persona REST API base URL */
  private static readonly API_BASE_URL = 'https://withpersona.com/api/v1'
  /**
   * Explicit Persona API version header to stabilize payload shape.
   * Adjust with care if/when your Persona workspace upgrades versions.
   */
  private static readonly API_VERSION = '2023-01-01'
  /** Network timeout (ms) for Persona requests */
  private static readonly REQUEST_TIMEOUT_MS = 10_000

  private axiosClient?: AxiosInstance
  private readonly cache = new Map<string, null | PersonaInquiryDetails>()

  constructor(
    private readonly secretManager: ISecretManager,
    /** Optional flags for local debugging, etc. */
    private readonly opts: { debug?: boolean } = {},
    private readonly logger: ILogger = new ConsoleLogger(),
  ) {}

  /**
   * Clear the memoized result(s).
   * - Call with an `inquiryId` to invalidate a single entry
   * - Call with no args to clear the entire cache
   */
  public clearCache(inquiryId?: string): void {
    if (inquiryId) this.cache.delete(inquiryId)
    else this.cache.clear()
  }

  /**
   * Fetch and normalize the details for a given Persona inquiry id.
   * Cached results are returned when available. On error, returns `null`
   * and caches the null to avoid repeat failures during pagination.
   *
   * @param inquiryId Persona inquiry id (e.g. `inq_...`). Falsy/blank returns `null`.
   */
  public async getDetails(inquiryId: string): Promise<null | PersonaInquiryDetails> {
    const id = inquiryId?.trim()
    if (!id) return null

    if (this.cache.has(id)) {
      return this.cache.get(id) ?? null
    }

    try {
      const client = await this.ensureClient()
      const { data } = await client.get(`/inquiries/${encodeURIComponent(id)}`, {
        params: { include: 'account,documents' },
      })

      this.debug('Persona inquiry payload', data)

      const details = this.parseInquiryPayload(data)
      this.cache.set(id, details)
      return details
    }
    catch (error) {
      this.logger.error('Failed to fetch Persona inquiry details', { error, inquiryId: id })
      this.cache.set(id, null)
      return null
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // HTTP client & configuration
  // ───────────────────────────────────────────────────────────────────────────────

  /** Narrows unknown to a plain object record (non-array). */
  private asRecord(value: unknown): JsonRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonRecord)
      : undefined
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // Payload parsing & normalization
  // ───────────────────────────────────────────────────────────────────────────────

  /** Safely coerce a value to a trimmed string, or return undefined. */
  private asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value.trim() || undefined : undefined
  }

  /**
   * Builds a single full name from Persona-style attributes.
   * Accepts either inquiry-level attributes or document attributes.
   */
  private buildFullNameFromAttributes(attrs?: JsonRecord): string | undefined {
    if (!attrs) return undefined
    const first = this.asString(attrs['name-first'])
    const middle = this.asString(attrs['name-middle'])
    const last = this.asString(attrs['name-last'])
    const parts = [first, middle, last].filter(Boolean) as string[]
    return parts.length ? parts.join(' ') : undefined
  }

  /**
   * Persona may return "document" resources under `included` (e.g. `document/government-id`).
   * We care only about the first such set of attributes for ID class/number/full name fallback.
   */
  private collectDocumentAttributes(included: JsonRecord[]): JsonRecord[] {
    return included
      .filter(item => typeof item.type === 'string' && String(item.type).startsWith('document'))
      .map(item => this.asRecord(item.attributes) ?? {})
  }

  /** Conditional debug logger (opt-in via constructor). */
  private debug(...args: unknown[]) {
    if (this.opts.debug) {
      this.logger.info('[PersonaInquiryDetailsService]', ...args)
    }
  }

  /**
   * Lazily initializes the Axios client with Persona auth & headers.
   * Throws if the required secret is missing; callers handle the error.
   */
  private async ensureClient(): Promise<AxiosInstance> {
    if (this.axiosClient) return this.axiosClient

    const { PERSONA_API_KEY } = await this.secretManager.getSecrets(['PERSONA_API_KEY'] as const)
    if (!PERSONA_API_KEY || typeof PERSONA_API_KEY !== 'string' || !PERSONA_API_KEY.trim()) {
      throw new Error('Missing required secret: PERSONA_API_KEY')
    }

    this.axiosClient = axios.create({
      baseURL: PersonaInquiryDetailsService.API_BASE_URL,
      headers: {
        'Authorization': `Bearer ${PERSONA_API_KEY}`,
        'Content-Type': 'application/json',
        'Persona-Version': PersonaInquiryDetailsService.API_VERSION,
      },
      timeout: PersonaInquiryDetailsService.REQUEST_TIMEOUT_MS,
    })

    return this.axiosClient
  }

  /**
   * Extracts the primary JSON:API resource and a flat list of included resources
   * from arbitrary Persona responses.
   *
   * Persona responses are typically `{ data, included }`. In some cases `data` may
   * itself nest a resource; this method unwraps such shapes.
   */
  private extractPrimaryResource(
    payload: JsonRecord,
  ): null | { included: JsonRecord[], resource: JsonRecord } {
    const included: JsonRecord[] = []
    const seen = new Set<unknown>()

    const collectIncluded = (value: unknown) => {
      if (!Array.isArray(value)) return
      for (const entry of value) {
        const asRec = this.asRecord(entry)
        if (asRec) included.push(asRec)
      }
    }

    const unwrap = (value: unknown): JsonRecord | null => {
      const rec = this.asRecord(value)
      if (!rec || seen.has(rec)) return null
      seen.add(rec)

      collectIncluded(rec.included)

      // JSON:API root is often { data: { ...resource } }
      const inner = (rec as JsonRecord).data
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        return unwrap(inner)
      }

      return rec
    }

    collectIncluded(payload.included)

    let resource = unwrap(payload.data)
    if (!resource) resource = unwrap(payload)
    if (!resource) return null

    // Be defensive: sometimes libraries stick `included` on nested nodes
    collectIncluded(resource.included)

    return { included, resource }
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // Small utilities
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * Helper to read `attributes.fields.<key>.value` safely.
   */
  private getFieldValue<T = unknown>(
    fields: JsonRecord | undefined,
    key: string,
  ): T | undefined {
    if (!fields) return undefined
    const entry = this.asRecord(fields[key])
    const value = entry?.value as T | undefined
    return value === null ? undefined : value
  }

  /**
   * Maps a Persona document-class code to a human-friendly Spanish label.
   * Falls back to the original code if unknown.
   *
   * Some labels vary by country (currently localized for CO).
   */
  private mapDocumentClassToLabel(code: string | undefined, country?: string): string | undefined {
    if (!code) return undefined
    const normalized = code.toLowerCase()
    const c = typeof country === 'string' ? country.toUpperCase() : undefined

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

  /**
   * Parses the Persona payload into our normalized structure.
   * Returns `null` if the payload is empty or malformed.
   */
  private parseInquiryPayload(payload: unknown): null | PersonaInquiryDetails {
    const root = this.asRecord(payload)
    if (!root) return null

    const container = this.extractPrimaryResource(root)
    if (!container) return null

    const { included, resource } = container

    const resourceAttrs = this.asRecord(resource.attributes)
    const resourceFields = this.asRecord(resourceAttrs?.fields)

    // Pull first "document/*" attributes (commonly government ID)
    const documentsAttributes = this.collectDocumentAttributes(included)
    const documentAttrs = documentsAttributes[0] ?? {}

    // Document class (e.g., 'pp', 'national_id', etc.)
    const documentClass
      = this.getFieldValue<string>(resourceFields, 'identification-class')
        ?? this.asString(documentAttrs['id-class'])

    // Prefer inquiry-level full name; fall back to document attributes if missing
    const fullName
      = this.buildFullNameFromAttributes(resourceAttrs)
        ?? this.buildFullNameFromAttributes(documentAttrs)

    // Address components (kebab-case as delivered by Persona)
    const addressLine1 = this.asString(resourceAttrs?.['address-street-1'])
    const addressLine2 = this.asString(resourceAttrs?.['address-street-2'])
    const city = this.asString(resourceAttrs?.['address-city'])
    const department = this.asString(resourceAttrs?.['address-subdivision'])
    const country
      = this.getFieldValue<string>(resourceFields, 'selected-country-code')
        ?? this.asString(resourceAttrs?.['address-country-code'])

    const address = [addressLine1, addressLine2].filter(Boolean).join(', ') || undefined

    // Determine the correct ID number to show
    const attrIdNumber
      = this.asString(resourceAttrs?.['identification-number'])
        ?? this.getFieldValue<string>(resourceFields, 'identification-number')

    const documentNumber = this.asString(documentAttrs['document-number'])
    const docIdentificationNumber = this.asString(documentAttrs['identification-number'])

    // For passports ('pp'), Persona often stores the number as `document-number`
    const idNumber
      = (documentClass === 'pp' ? documentNumber : attrIdNumber ?? docIdentificationNumber)
        ?? attrIdNumber

    // Contact info can be under attributes or fields.<key>.value
    const email
      = this.asString(resourceAttrs?.['email-address'])
        ?? this.getFieldValue<string>(resourceFields, 'email-address')

    const phone
      = this.asString(resourceAttrs?.['phone-number'])
        ?? this.getFieldValue<string>(resourceFields, 'phone-number')

    const documentType = this.mapDocumentClassToLabel(documentClass, country)

    return {
      address,
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
