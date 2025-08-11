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
      description: 'Abroad Wallet Connect',
      icons: ['https://cdn.prod.website-files.com/66d73974e0b6f2e9c06130a7/67bdb92323f0bb399db3754c_abroad-logo.svg'],
      method: WalletConnectAllowedMethods.SIGN,
      name: 'Abroad Wallet Connect',
      network: WalletNetwork.PUBLIC,
      projectId: '5686074a7981cd147a5f0d7434a6d4b7',
      url: 'https://app.abroad.finance',
    }),
    new HotWalletModule(),
    new xBullModule(),
    new HanaModule()
  ]
});