#!/usr/bin/env -S npx tsx
// src/listeners/index.ts

import { iocContainer } from '../ioc'
import { BinanceListener } from './binance'
import { StellarListener } from './stellar'

if (require.main === module) {
  iocContainer.bind<StellarListener>('StellarListener').to(StellarListener)
  const stellarListener = iocContainer.get<StellarListener>('StellarListener')
  stellarListener.start()

  iocContainer.bind<BinanceListener>('BinanceListener').to(BinanceListener)
  const binanceListener = iocContainer.get<BinanceListener>('BinanceListener')
  binanceListener.start()
}
