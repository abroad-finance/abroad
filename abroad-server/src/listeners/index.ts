// src/listeners/index.ts

import { ILogger } from '../interfaces'
import { iocContainer } from '../ioc'
import { TYPES } from '../types'
import { BinanceListener } from './binance'
import { StellarListener } from './stellar'

/**
 * Register and start all listeners.
 */
export function startListeners(): void {
  const logger = iocContainer.get<ILogger>(TYPES.ILogger)
  // Keep strong references so listeners are not GC'd
  iocContainer
    .bind<StellarListener>('StellarListener')
    .to(StellarListener)
    .inSingletonScope()

  const stellar = iocContainer.get<StellarListener>('StellarListener')
  // Store on module scope to keep a reference
  running.stellar = stellar
  stellar.start().catch(err =>
    logger.error('[listeners] Error starting StellarListener:', err),
  )

  iocContainer.bind<BinanceListener>('BinanceListener').to(BinanceListener)
  iocContainer.get<BinanceListener>('BinanceListener').start()
}

/** Keep module-level references to prevent GC. */
const running: { stellar?: StellarListener } = {}

function stopListeners(): void {
  try {
    running.stellar?.stop()
  }
  finally {
    running.stellar = undefined
  }
}

if (require.main === module) {
  startListeners()
  process.on('SIGINT', () => {
    stopListeners()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    stopListeners()
    process.exit(0)
  })
}
