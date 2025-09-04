import type { ISupportedWallet, StellarWalletsKit } from '@creit.tech/stellar-wallets-kit'

import { WalletNetwork } from '@creit.tech/stellar-wallets-kit'

// src/wallet/adapters/KitWalletAdapter.ts
import type { IWallet, SignOpts } from '../interfaces/IWallet'

export class KitWalletAdapter implements IWallet {
  constructor(private readonly kit: StellarWalletsKit) {}

  async disconnect(): Promise<void> {
    return this.kit.disconnect()
  }

  async getAddress(): Promise<{ address: string }> {
    return this.kit.getAddress()
  }

  async openModal(params: {
    modalTitle?: string
    notAvailableText?: string
    onClosed?: (err: Error) => void
    onWalletSelected: (option: ISupportedWallet) => void
  }): Promise<void> {
    await this.kit.openModal(params)
  }

  setWallet(id: string): void {
    this.kit.setWallet(id)
  }

  async signTransaction(
    xdr: string,
    opts?: SignOpts,
  ): Promise<{ signedTxXdr: string, signerAddress?: string }> {
    // address: use provided or fetch from the kit
    const address
      = opts?.address ?? (await this.kit.getAddress({ path: opts?.path })).address

    const { signedTxXdr } = await this.kit.signTransaction(xdr, {
      address,
      networkPassphrase: opts?.networkPassphrase ?? WalletNetwork.PUBLIC,
      submit: opts?.submit,
      submitUrl: opts?.submitUrl,
    })

    return { signedTxXdr, signerAddress: address }
  }
}
