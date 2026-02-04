/**
 * Utility functions for QR code parsing to reduce cognitive complexity
 * in useWebSwapController.ts
 */

export interface PixDecodedData {
  key?: string
  name?: string
  amount?: string
  taxId?: string
  error?: string
}

/**
 * Decodes a Pix QR code string
 * @param qrCode - The raw QR code string
 * @returns Decoded Pix data or error
 */
export function decodePixQr(qrCode: string): PixDecodedData {
  // Check for EMV CoE standard format (starting with 000201)
  if (qrCode.startsWith('000201')) {
    return decodeEmvCoE(qrCode)
  }

  // Fallback for other formats - assume key=value format
  if (qrCode.includes('=')) {
    const parts = qrCode.split('&').reduce<Record<string, string>>((acc, part) => {
      const [key, value] = part.split('=')
      if (key && value) {
        acc[key] = decodeURIComponent(value)
      }
      return acc
    }, {})

    return {
      key: parts.key || parts.pixKey,
      name: parts.name || parts.recipient,
      amount: parts.amount || parts.value,
      taxId: parts.taxId || parts.cpf || parts.cnpj,
    }
  }

  return { error: 'Unknown QR format' }
}

/**
 * Decodes EMV CoE (Código de Estabelecimento) format
 * This is the standard Pix QR format used in Brazil
 */
function decodeEmvCoE(qrCode: string): PixDecodedData {
  const result: PixDecodedData = {}
  let currentPosition = 0

  while (currentPosition < qrCode.length) {
    // ID field (2 chars)
    const id = qrCode.substring(currentPosition, currentPosition + 2)
    currentPosition += 2

    // Length field (2 chars)
    const length = Number.parseInt(qrCode.substring(currentPosition, currentPosition + 2), 10)
    currentPosition += 2

    // Value field
    const value = qrCode.substring(currentPosition, currentPosition + length)
    currentPosition += length

    // Parse known fields
    switch (id) {
      case '01': // Point of Initiation
        break
      case '02': // Merchant Category Code
        break
      case '05': // Transaction Currency (986 = BRL)
        break
      case '54': // Transaction Amount
        if (value) result.amount = value
        break
      case '59': // Merchant Name
        if (value) result.name = value
        break
      case '60': // Merchant City
        break
      case '62': { // Additional Data Field
        // Contains reference field which often has the Pix key
        const refId = parseAdditionalDataField(value)
        if (refId) result.key = refId
        break
      }
    }
  }

  return result
}

/**
 * Parses the additional data field in EMV CoE
 */
function parseAdditionalDataField(data: string): string | undefined {
  // Look for reference field (ID 05)
  if (data.startsWith('05')) {
    const refLength = Number.parseInt(data.substring(2, 4), 10)
    return data.substring(4, 4 + refLength)
  }
  return undefined
}

/**
 * Validates a Pix key format
 * @param key - The Pix key to validate
 * @returns true if valid format
 */
export function isValidPixKey(key: string): boolean {
  if (!key || key.length < 3 || key.length > 256) return false

  // Check if it's an email
  if (key.includes('@') && key.includes('.')) {
    // ReDoS safe regex: Excludes dots from the domain segments to avoid greedy matching overlaps
    // Structure: local@domain_part(.domain_part)+
    return /^[^\s@]+@[^\s@\.]+(\.[^\s@\.]+)+$/.test(key)
  }

  // Check if it's a CPF (11 digits)
  if (/^\d{11}$/.test(key)) {
    return isValidCpf(key)
  }

  // Check if it's a CNPJ (14 digits)
  if (/^\d{14}$/.test(key)) {
    return isValidCnpj(key)
  }

  // Check if it's an EVP (UUID format)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
    return true
  }

  // Check if it's a phone number (DDD + number)
  if (/^\+?55\d{10,11}$/.test(key)) {
    return true
  }

  return false
}

/**
 * Validates CPF using the official algorithm
 */
function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf)) return false

  // Check for repeated numbers
  if (/^(\d)\1{10}$/.test(cpf)) return false

  // Validate first check digit
  let sum = 0
  for (let i = 0; i < 9; i++) {
    sum += Number.parseInt(cpf[i]) * (10 - i)
  }
  let digit = (sum * 10) % 11
  if (digit === 10) digit = 0
  if (digit !== Number.parseInt(cpf[9])) return false

  // Validate second check digit
  sum = 0
  for (let i = 0; i < 10; i++) {
    sum += Number.parseInt(cpf[i]) * (11 - i)
  }
  digit = (sum * 10) % 11
  if (digit === 10) digit = 0
  if (digit !== Number.parseInt(cpf[10])) return false

  return true
}

/**
 * Validates CNPJ using the official algorithm
 */
function isValidCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj)) return false

  // Check for repeated numbers
  if (/^(\d)\1{13}$/.test(cnpj)) return false

  // Validate first check digit
  let sum = 0
  let weight = 5
  for (let i = 0; i < 12; i++) {
    sum += Number.parseInt(cnpj[i]) * weight
    weight = weight === 2 ? 9 : weight - 1
  }
  let digit = sum % 11
  if (digit < 2) digit = 0
  else digit = 11 - digit
  if (digit !== Number.parseInt(cnpj[12])) return false

  // Validate second check digit
  sum = 0
  weight = 6
  for (let i = 0; i < 13; i++) {
    sum += Number.parseInt(cnpj[i]) * weight
    weight = weight === 2 ? 9 : weight - 1
  }
  digit = sum % 11
  if (digit < 2) digit = 0
  else digit = 11 - digit
  if (digit !== Number.parseInt(cnpj[13])) return false

  return true
}
