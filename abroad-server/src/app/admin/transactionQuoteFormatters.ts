const DEFAULT_LOCALE = 'es-CO'

/**
 * Identity fields surfaced in the AdminJS transaction-quote view / CSV export.
 * Sourced from the user's stored KYC submission (previously fetched from Persona).
 */
export interface KycRecordDetails {
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

export function applyQuoteProjection(record: { params: Record<string, unknown> }, values: {
  cryptoCurrency: string | undefined
  fiatCurrencies: ReadonlySet<string>
  sourceAmount: null | number
  targetAmount: null | number
  targetCurrency: string | undefined
}) {
  const { cryptoCurrency, fiatCurrencies, sourceAmount, targetAmount, targetCurrency } = values

  const montoCop = targetCurrency === 'COP' ? formatAmount(targetAmount) : ''
  const montoUsdc = cryptoCurrency === 'USDC' ? formatAmount(sourceAmount) : ''

  record.params.montoCop = montoCop
  record.params.montoUsdc = montoUsdc

  const trmValue = deriveTrm(targetAmount, sourceAmount)

  record.params.trm = formatAmount(trmValue)
  record.params.tipoOperacion = getOperationLabel(targetCurrency, fiatCurrencies)
}

export function assignTransactionMetadata(
  record: { params: Record<string, unknown> },
  transactionCreatedAt: unknown,
  onChainId: unknown,
  fiatCurrencies: ReadonlySet<string>,
) {
  record.params.fecha = formatDateTime(transactionCreatedAt)
  record.params.hashTransaccion = typeof onChainId === 'string' ? onChainId : ''
  const targetCurrency = typeof record.params.targetCurrency === 'string' ? record.params.targetCurrency : undefined
  record.params.tipoOperacion = getOperationLabel(targetCurrency, fiatCurrencies)
}

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\n\r]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue
}

export function formatDateTime(value: unknown): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().replace('T', ' ').slice(0, 16)
}

export function hydrateKycAndQuoteFields(
  record: { params: Record<string, unknown> },
  kyc: KycRecordDetails | null,
  fiatCurrencies: ReadonlySet<string>,
) {
  ensureKycFields(record, kyc)

  const targetAmount = parseNumber(record.params.targetAmount)
  const sourceAmount = parseNumber(record.params.sourceAmount)
  const cryptoCurrency = typeof record.params.cryptoCurrency === 'string'
    ? record.params.cryptoCurrency
    : undefined
  const targetCurrency = typeof record.params.targetCurrency === 'string'
    ? record.params.targetCurrency
    : undefined

  assignTransactionMetadata(record, record.params.transactionCreatedAt, record.params.onChainId, fiatCurrencies)
  applyQuoteProjection(record, { cryptoCurrency, fiatCurrencies, sourceAmount, targetAmount, targetCurrency })
}

export function parseNumber(value: unknown): null | number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const normalised = value.replace(/,/g, '')
    const parsed = Number(normalised)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function deriveTrm(targetAmount: null | number, sourceAmount: null | number): null | number {
  if (targetAmount === null || sourceAmount === null || sourceAmount === 0) {
    return null
  }
  return targetAmount / sourceAmount
}

function ensureKycFields(record: { params: Record<string, unknown> }, kyc: KycRecordDetails | null) {
  record.params.tipoDocumento = kyc?.documentType ?? ''
  record.params.numeroDocumento = kyc?.idNumber ?? ''
  record.params.nombreRazonSocial = kyc?.fullName ?? ''
  record.params.direccion = kyc?.address ?? ''
  record.params.telefono = kyc?.phone ?? ''
  record.params.email = kyc?.email ?? ''
  record.params.pais = kyc?.country ?? ''
  record.params.departamento = kyc?.department ?? ''
  record.params.municipio = kyc?.city ?? ''
}

function formatAmount(value: null | number, locale: string = DEFAULT_LOCALE): string {
  if (value === null || Number.isNaN(value)) return ''
  try {
    return value.toLocaleString(locale, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    })
  }
  catch {
    return value.toFixed(2)
  }
}

function getOperationLabel(targetCurrency: unknown, fiatCurrencies: ReadonlySet<string>): string {
  const currency = typeof targetCurrency === 'string' ? targetCurrency.toUpperCase() : ''
  return fiatCurrencies.has(currency) ? 'Venta' : 'Compra'
}
