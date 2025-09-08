import { Container } from 'inversify'

import type { IWalletAuthentication } from './interfaces/IWalletAuthentication'

import { ITypes } from './interfaces/ITypes'
import { IWallet } from './interfaces/IWallet'
import { IWalletFactory } from './interfaces/IWalletFactory'
import { WalletAuthentication } from './services/WalletAuthentication'
import { WalletFactory } from './services/WalletFactory'
import { StellarKitWallet } from './services/wallets/StellarKitWallet'

// Create a lightweight IoC container for the UI
const container = new Container({ defaultScope: 'Singleton' })

// Bind services
container
  .bind<IWalletAuthentication>(ITypes.IWalletAuthentication)
  .to(WalletAuthentication)

container.bind<IWallet>(ITypes.IWallet).to(StellarKitWallet).whenNamed('stellar-kit')
container.bind<IWallet>(ITypes.IWallet).to(StellarKitWallet).whenNamed('wallet-connect')

container.bind<IWalletFactory>(ITypes.IWalletFactory).to(WalletFactory)

export const iocContainer = container
