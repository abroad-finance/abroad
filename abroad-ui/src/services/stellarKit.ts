import {
  AlbedoModule,
  FreighterModule,
  HanaModule,
  HotWalletModule,
  LobstrModule,
  StellarWalletsKit,
  WalletNetwork,
  xBullModule,

} from '@creit.tech/stellar-wallets-kit';
import {
  WalletConnectAllowedMethods,
  WalletConnectModule,
} from '@creit.tech/stellar-wallets-kit/modules/walletconnect.module';
import { LedgerModule } from '@creit.tech/stellar-wallets-kit/modules/ledger.module';

export const kit: StellarWalletsKit = new StellarWalletsKit({
  network: WalletNetwork.PUBLIC,
  modules: [
    new FreighterModule(),
    new LobstrModule(),
    new AlbedoModule(),
    new LedgerModule(),
    new WalletConnectModule({
      description: 'Abroad bridges USDC on Stellar with real-time payment networks around the world, enabling seamless crypto-fiat payments. You will be able to pay anywhere in Brazil and Colombia with your USDC.',
      icons: ['https://storage.googleapis.com/cdn-abroad/Icons/Favicon/Abroad_Badge_transparent.png'],
      method: WalletConnectAllowedMethods.SIGN,
      name: 'Abroad',
      network: WalletNetwork.PUBLIC,
      projectId: '5686074a7981cd147a5f0d7434a6d4b7',
      url: 'https://app.abroad.finance',
    }),
    new HotWalletModule(),
    new xBullModule(),
    new HanaModule()
  ]
});