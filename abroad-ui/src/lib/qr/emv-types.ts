export interface KeyInfo {
  source: string
  type: 'alias' | 'email' | 'nit' | 'phone' | 'uuid'
  value: string
}

export interface MerchantAccount {
  globalId: string
  id: string
  network: NetworkInfo | null
  rawValue: string
  subFields: SubField[]
}

export interface NetworkInfo {
  color: string
  name: string
}

export interface ParsedQR {
  amount: null | number
  country: null | string
  crc: null | string
  currency: null | string // "170" = COP, "986" = BRL
  isBreB: boolean
  isDynamic: boolean
  keyInfo: KeyInfo | null
  merchantAccounts: MerchantAccount[]
  merchantCity: null | string
  merchantName: null | string
  raw: string
  timestamp: Date
}

export interface SubField {
  id: string
  label: string
  value: string
}

export interface TLVEntry {
  id: string
  len: number
  value: string
}
