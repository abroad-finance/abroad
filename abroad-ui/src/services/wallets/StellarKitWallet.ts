import {
  AlbedoModule,
  FreighterModule,
  HanaModule,
  HotWalletModule,
  LobstrModule,
  StellarWalletsKit,
  WalletNetwork,
  xBullModule,
} from '@creit.tech/stellar-wallets-kit'
import { LedgerModule } from '@creit.tech/stellar-wallets-kit/modules/ledger.module'
import {
  WalletConnectAllowedMethods,
  WalletConnectModule,
} from '@creit.tech/stellar-wallets-kit/modules/walletconnect.module'
import { inject } from 'inversify'

import type { IWallet } from '../../interfaces/IWallet'
import type { IWalletAuthentication } from '../../interfaces/IWalletAuthentication'

import { ITypes } from '../../interfaces/ITypes'
import { WALLET_CONNECT_ID } from '../../shared/constants'

const walletConnectModule = new WalletConnectModule({
  description: 'Abroad bridges USDC on Stellar with real-time payment networks around the world, enabling seamless crypto-fiat payments. You will be able to pay anywhere in Brazil and Colombia with your USDC.',
  icons: ['https://storage.googleapis.com/cdn-abroad/Icons/Favicon/Abroad_Badge_transparent.png'],
  method: WalletConnectAllowedMethods.SIGN,
  name: 'Abroad',
  network: WalletNetwork.PUBLIC,
  projectId: WALLET_CONNECT_ID,
  url: 'https://app.abroad.finance',
})

const isMobile = typeof window !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

// If mobile, expose only WalletConnect; otherwise include full set
const modules = isMobile
  ? [walletConnectModule]
  : [
      new FreighterModule(),
      new LobstrModule(),
      new AlbedoModule(),
      new LedgerModule(),
      walletConnectModule,
      new HotWalletModule(),
      new xBullModule(),
      new HanaModule(),
    ]

export class StellarKitWallet implements IWallet {
  private readonly kit: StellarWalletsKit = new StellarWalletsKit({
    modules,
    network: WalletNetwork.PUBLIC,
  })

  constructor(
    @inject(ITypes.IWalletAuthentication) private walletAuth: IWalletAuthentication,
  ) { }

  async connect() {
    return new Promise<{ authToken: string }>((resolve) => {
      this.kit.openModal({
        onWalletSelected: async (options) => {
          this.kit.setWallet(options.id)

          const { address } = await this.getAddress()
          const { message } = await this.walletAuth.getChallengeMessage({ address })
          const { signedTxXdr } = await this.signTransaction({ message })
          const { token } = await this.walletAuth.getAuthToken({ address, signedMessage: signedTxXdr })

          resolve({ authToken: token })
        },
      })
    })
  }

  async disconnect(): Promise<void> {
    return this.kit.disconnect()
  }

  async getAddress(): Promise<{ address: string }> {
    return this.kit.getAddress()
  }

  async signTransaction(
    { message }: { message: string },
  ): Promise<{ signedTxXdr: string, signerAddress?: string }> {
    const { address } = await this.getAddress()
    const { signedTxXdr } = await this.kit.signTransaction(message, {
      address,
      networkPassphrase: WalletNetwork.PUBLIC,
    })

    return { signedTxXdr, signerAddress: address }
  }
}
