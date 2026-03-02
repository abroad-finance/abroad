export interface TLVEntry {
  id: string
  len: number
  value: string
}

export interface SubField {
  id: string
  value: string
  label: string
}

export interface NetworkInfo {
  name: string
  color: string
}

export interface MerchantAccount {
  id: string
  rawValue: string
  globalId: string
  network: NetworkInfo | null
  subFields: SubField[]
}

export interface KeyInfo {
  value: string
  source: string
  type: 'alias' | 'email' | 'nit' | 'phone' | 'uuid'
}

export interface ParsedQR {
  amount: number | null
  country: string | null
  crc: string | null
  currency: string | null // "170" = COP, "986" = BRL
  isBreB: boolean
  isDynamic: boolean
  keyInfo: KeyInfo | null
  merchantAccounts: MerchantAccount[]
  merchantCity: string | null
  merchantName: string | null
  raw: string
  timestamp: Date
}
