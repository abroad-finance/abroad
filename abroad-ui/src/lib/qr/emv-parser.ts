import type {
  KeyInfo, MerchantAccount, NetworkInfo, ParsedQR, TLVEntry,
} from './emv-types'

// ─── Network patterns ─────────────────────────────────────────────────────────

const NETWORK_PATTERNS: Record<string, NetworkInfo> = {
  'ach': { color: '#3b82f6', name: 'ACH Colombia' },
  'bancolombia': { color: '#fdda24', name: 'Bancolombia' },
  'br.gov': { color: '#32bcad', name: 'PIX Brasil' },
  'bre-b': { color: '#10b981', name: 'Bre-B' },
  'breb': { color: '#10b981', name: 'Bre-B' },
  'co.bre-b': { color: '#10b981', name: 'Bre-B' },
  // Redes colombianas
  'co.com.rbm': { color: '#10b981', name: 'Bre-B' },
  'co.gov': { color: '#10b981', name: 'Bre-B (Gov CO)' },
  // Bre-B Colombia (identificadores oficiales Superfinanciera / ACH Colombia)
  'co.gov.superfinanciera': { color: '#10b981', name: 'Bre-B' },
  'daviplata': { color: '#e60000', name: 'Daviplata' },
  'entrecuentas': { color: '#8b5cf6', name: 'EntreCuentas' },
  'mastercard': { color: '#eb001b', name: 'Mastercard' },
  'movii': { color: '#00b4e0', name: 'MOVii' },
  'nequi': { color: '#7c0cfa', name: 'Nequi' },
  'pix': { color: '#32bcad', name: 'PIX' },
  'rbm': { color: '#10b981', name: 'Bre-B' },
  'redeban': { color: '#ef4444', name: 'Redeban' },
  // Internacionales
  'visa': { color: '#1a1f71', name: 'Visa' },
}

// ─── TLV Core ─────────────────────────────────────────────────────────────────

export function detectKeyType(value: string): KeyInfo['type'] {
  if (value.startsWith('@')) return 'alias'
  if (/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value)) return 'uuid'
  if (value.includes('@') && value.includes('.')) return 'email'
  if (/^\+?\d{10,13}$/.test(value)) return 'phone'
  if (/^\d{9,12}$/.test(value)) return 'nit'
  return 'alias'
}

// ─── Pre-processing ───────────────────────────────────────────────────────────

export function detectNetwork(globalId: string): NetworkInfo | null {
  if (!globalId) return null
  const id = globalId.toLowerCase()
  for (const [pattern, info] of Object.entries(NETWORK_PATTERNS)) {
    if (id.includes(pattern)) return info
  }
  return null
}

// ─── Network / Key detection ──────────────────────────────────────────────────

/**
 * Extrae el payload EMVCo puro de un string que puede ser:
 * - EMV directo: "000201..."
 * - URL con param: "https://pay.app/qr?payload=000201..."
 * - Deeplink: "bancolombia://pay?qr=000201..."
 * - Base64: "MDAwMjAx..."
 */
export function extractEMVPayload(raw: string): string {
  const trimmed = raw.trim()

  if (trimmed.startsWith('0002')) return trimmed

  // URL o deeplink → buscar el payload EMV en query params
  try {
    const urlStr = trimmed.includes('://')
      ? trimmed.replace(/^[a-zA-Z][\w+\-.]*:\/\//, 'https://')
      : trimmed

    const url = new URL(urlStr.startsWith('http') ? urlStr : `https://x.co?${urlStr}`)
    const candidateParams = [
      'payload',
      'Payload',
      'qr',
      'QR',
      'data',
      'Data',
      'emv',
      'EMV',
      'p',
      'q',
      'code',
      'qrcode',
      'content',
      'br_code',
      'brcode',
    ]

    for (const name of candidateParams) {
      const val = url.searchParams.get(name)
      if (val && val.startsWith('0002')) return decodeURIComponent(val)
    }

    for (const [, val] of url.searchParams.entries()) {
      const decoded = decodeURIComponent(val)
      if (decoded.startsWith('0002')) return decoded
    }
  }
  catch { /* not a valid URL, continue */ }

  // Intentar base64
  try {
    const decoded = atob(trimmed)
    if (decoded.startsWith('0002')) return decoded
  }
  catch { /* not base64 */ }

  return trimmed
}

export function parseEMVQR(rawData: string): ParsedQR {
  const emvPayload = extractEMVPayload(rawData.trim())
  const entries = parseTLV(emvPayload)

  const result: ParsedQR = {
    amount: null,
    country: null,
    crc: null,
    currency: null,
    isBreB: false,
    isDynamic: false,
    keyInfo: null,
    merchantAccounts: [],
    merchantCity: null,
    merchantName: null,
    raw: rawData.trim(),
    timestamp: new Date(),
  }

  for (const entry of entries) {
    const idNum = Number.parseInt(entry.id, 10)

    // Merchant Account Information (02–51)
    if (!Number.isNaN(idNum) && idNum >= 2 && idNum <= 51) {
      const subEntries = parseTLV(entry.value)
      const globalId = subEntries.find(s => s.id === '00')?.value ?? ''
      const network = detectNetwork(globalId)

      if (/redeban|ach|entrecuentas|bre-?b|superfinanciera|co\.gov|co\.bre|co\.com\.rbm/i.test(globalId)) {
        result.isBreB = true
      }

      const account: MerchantAccount = {
        globalId,
        id: entry.id,
        network,
        rawValue: entry.value,
        subFields: subEntries.map(s => ({
          id: s.id,
          label: s.id === '00'
            ? 'Identificador Global'
            : s.id === '01'
              ? 'Llave / Destinatario'
              : s.id === '02'
                ? 'Datos de Acceso'
                : `Campo ${s.id}`,
          value: s.value,
        })),
      }

      if (subEntries.length === 0 && entry.value.length > 0) {
        account.subFields = [{ id: '??', label: 'Valor raw', value: entry.value }]
      }

      if (!result.keyInfo) {
        // Skip short all-caps codes (network identifiers like "RBM", "APP") — prefer real keys (≥ 6 chars)
        const candidate
          = subEntries.find(s => s.id !== '00' && s.value.length >= 6)
            ?? subEntries.find(s => s.id !== '00' && s.value.length > 0 && !/^[A-Z]{1,5}$/.test(s.value))
        if (candidate) {
          result.keyInfo = {
            source: network?.name ?? `Cuenta ${entry.id}`,
            type: detectKeyType(candidate.value),
            value: candidate.value,
          }
        }
      }

      result.merchantAccounts.push(account)
    }
    else {
      switch (entry.id) {
        case '01':
          result.isDynamic = entry.value === '12'
          break
        case '53':
          result.currency = entry.value
          break
        case '54':
          result.amount = Number.parseFloat(entry.value) || null
          break
        case '58':
          result.country = entry.value
          break
        case '59':
          result.merchantName = entry.value
          break
        case '60':
          result.merchantCity = entry.value
          break
        case '62': {
          // Additional Data Field Template — extract Mobile Number (sub-tag 02) as keyInfo fallback.
          // Nequi (Colombia) stores the recipient phone in field 62.02 instead of a merchant account sub-field.
          if (!result.keyInfo) {
            const additional = parseTLV(entry.value)
            const mobile = additional.find(s => s.id === '02')
            if (mobile?.value) {
              result.keyInfo = {
                source: 'Nequi',
                type: 'phone',
                value: mobile.value,
              }
            }
          }
          break
        }
        case '63':
          result.crc = entry.value
          break
      }
    }
  }

  return result
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseTLV(data: string): TLVEntry[] {
  const entries: TLVEntry[] = []
  let i = 0

  while (i + 4 <= data.length) {
    const id = data.substring(i, i + 2)
    const lenStr = data.substring(i + 2, i + 4)
    const len = Number.parseInt(lenStr, 10)

    if (Number.isNaN(len) || len < 0 || i + 4 + len > data.length) break

    const value = data.substring(i + 4, i + 4 + len)
    entries.push({ id, len, value })
    i += 4 + len
  }

  return entries
}
