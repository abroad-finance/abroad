export interface IPixQrDecoder {
  decode(qrCode: string): Promise<null | PixDecoded>
}

export interface PixDecoded {
  account?: string
  amount?: string
  currency?: string
  name?: string
  taxId?: null | string
}
