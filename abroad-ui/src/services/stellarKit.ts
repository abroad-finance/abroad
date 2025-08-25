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

// Basic mobile detection (UA based) – sufficient for gating wallet options
const isMobile = typeof window !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

const walletConnectModule = new WalletConnectModule({
  description: 'Abroad bridges USDC on Stellar with real-time payment networks around the world, enabling seamless crypto-fiat payments. You will be able to pay anywhere in Brazil and Colombia with your USDC.',
  icons: ['https://storage.googleapis.com/cdn-abroad/Icons/Favicon/Abroad_Badge_transparent.png'],
  method: WalletConnectAllowedMethods.SIGN,
  name: 'Abroad',
  network: WalletNetwork.PUBLIC,
  projectId: '5686074a7981cd147a5f0d7434a6d4b7',
  url: 'https://app.abroad.finance',
})

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

export const kit: StellarWalletsKit = new StellarWalletsKit({
  modules,
  network: WalletNetwork.PUBLIC,
})
