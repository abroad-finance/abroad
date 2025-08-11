export interface PixDecoded {
  countryCode?: string
  crc16?: string
  merchantAccount: {
    description?: string
    gui: string
    key?: string
    url?: string
  }
  merchantCategoryCode?: string
  merchantCity?: string
  merchantName?: string
  payloadFormatIndicator: string
  pointOfInitiationMethod?: 'dynamic' | 'static'
  raw: Record<string, string>
  transactionAmount?: string
  transactionCurrency?: string
  txid?: string
}


 export const decodePixQrCode = (brCode: string): PixDecoded => {
    const raw: Record<string, string> = {}
    let i = 0

    const readTLV = () => {
      const tag = brCode.slice(i, i + 2)
      const len = parseInt(brCode.slice(i + 2, i + 4), 10)
      const value = brCode.slice(i + 4, i + 4 + len)
      i += 4 + len
      return { tag, value }
    }

    while (i < brCode.length) {
      const { tag, value } = readTLV()
      raw[tag] = value
    }

    const parseNested = (block: string) => {
      const out: Record<string, string> = {}
      let idx = 0
      while (idx < block.length) {
        const t = block.slice(idx, idx + 2)
        const l = parseInt(block.slice(idx + 2, idx + 4), 10)
        const v = block.slice(idx + 4, idx + 4 + l)
        out[t] = v
        idx += 4 + l
      }
      return out
    }

    const mAccount = parseNested(raw['26'] ?? '')
    const additional = parseNested(raw['62'] ?? '')

    const decoded: PixDecoded = {
      countryCode: raw['58'],
      crc16: raw['63'],
      merchantAccount: {
        description: mAccount['02'],
        gui: mAccount['00'],
        key: mAccount['01'],
        url: mAccount['25'],
      },
      merchantCategoryCode: raw['52'],
      merchantCity: raw['60'],
      merchantName: raw['59'],
      payloadFormatIndicator: raw['00'],
      pointOfInitiationMethod:
        raw['01'] === '11'
          ? 'static'
          : raw['01'] === '12'
            ? 'dynamic'
            : undefined,
      raw,
      transactionAmount: raw['54'],
      transactionCurrency: raw['53'],
      txid: additional['05'],
    }

    if (decoded.crc16 && !verifyCRC(brCode)) {
      throw new Error('CRC-16 check failed – corrupted or incomplete BRCode')
    }

    return decoded
  }

  const crc16ccitt = (data: string): string => {
    let crc = 0xffff
    for (const c of data) {
      crc ^= c.charCodeAt(0) << 8
      for (let k = 0; k < 8; k++) {
        crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1
        crc &= 0xffff
      }
    }
    return crc.toString(16).padStart(4, '0')
  }

  const verifyCRC = (brCode: string): boolean => {
    const payload = brCode.slice(0, -4) // …6304
    const given = brCode.slice(-4).toUpperCase()
    const calc = crc16ccitt(payload).toUpperCase()
    return given === calc
  }
