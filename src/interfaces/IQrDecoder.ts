export interface IPixQrDecoder {
  decode(brCode: string): PixDecoded
}

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
