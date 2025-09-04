// src/wallet/IWallet.ts
import type { ISupportedWallet } from '@creit.tech/stellar-wallets-kit'

export interface IWallet {
  disconnect(): Promise<void>

  getAddress(params?: { path?: string }): Promise<{ address: string }>

  openModal(params: {
    modalTitle?: string
    notAvailableText?: string
    onClosed?: (err: Error) => void
    onWalletSelected: (option: ISupportedWallet) => void
  }): Promise<void>

  setWallet(id: string): void

  signTransaction(
    xdr: string,
    opts?: SignOpts
  ): Promise<{ signedTxXdr: string, signerAddress?: string }>
}

export type SignOpts = {
  address?: string
  networkPassphrase?: string
  path?: string
  submit?: boolean
  submitUrl?: string
}
