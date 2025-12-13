import type { PersonaInquiryDetails } from '../../modules/kyc/application/PersonaInquiryDetailsService'

const DEFAULT_LOCALE = 'es-CO'

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

export function hydratePersonaAndQuoteFields(
  record: { params: Record<string, unknown> },
  persona: null | PersonaInquiryDetails,
  fiatCurrencies: ReadonlySet<string>,
) {
  ensurePersonaFields(record, persona)

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

function ensurePersonaFields(record: { params: Record<string, unknown> }, persona: null | PersonaInquiryDetails) {
  record.params.tipoDocumento = persona?.documentType ?? ''
  record.params.numeroDocumento = persona?.idNumber ?? ''
  record.params.nombreRazonSocial = persona?.fullName ?? ''
  record.params.direccion = persona?.address ?? ''
  record.params.telefono = persona?.phone ?? ''
  record.params.email = persona?.email ?? ''
  record.params.pais = persona?.country ?? ''
  record.params.departamento = persona?.department ?? ''
  record.params.municipio = persona?.city ?? ''
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
