// src/listeners/index.ts

import { iocContainer } from '../ioc'
// import { BinanceListener } from './binance'
import { StellarListener } from './stellar'

/**
 * Register and start all listeners.
 */
export function startListeners(): void {
  iocContainer.bind<StellarListener>('StellarListener').to(StellarListener)
  iocContainer.get<StellarListener>('StellarListener').start()

  // iocContainer.bind<BinanceListener>('BinanceListener').to(BinanceListener)
  // iocContainer.get<BinanceListener>('BinanceListener').start()
}

if (require.main === module) {
  startListeners()
}
