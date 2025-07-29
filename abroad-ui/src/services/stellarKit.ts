import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
} from '@creit.tech/stellar-wallets-kit';

export const kit: StellarWalletsKit = new StellarWalletsKit({
  network: WalletNetwork.PUBLIC,
  modules: allowAllModules(),
});