// src/listeners/index.ts

import { iocContainer } from '../../../../app/container'
import { TYPES } from '../../../../app/container/types'
import { createScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { BinanceListener } from './BinanceListener'
import { StellarConfidentialListener } from './StellarConfidentialListener'
import { StellarListener } from './StellarListener'

/**
 * Register and start all listeners.
 */
export function startListeners(): void {
  const baseLogger = iocContainer.get<ILogger>(TYPES.ILogger)
  const logger = createScopedLogger(baseLogger, { scope: 'listeners' })
  // Keep strong references so listeners are not GC'd
  const stellar = iocContainer.get<StellarListener>(TYPES.StellarListener)
  running.stellar = stellar
  stellar.start().catch(err =>
    logger.error('Error starting StellarListener:', err),
  )

  // Idles unless a ConfidentialAssetConfig row is enabled.
  const stellarConfidential = iocContainer.get<StellarConfidentialListener>(TYPES.StellarConfidentialListener)
  running.stellarConfidential = stellarConfidential
  stellarConfidential.start().catch(err =>
    logger.error('Error starting StellarConfidentialListener:', err),
  )

  iocContainer.bind<BinanceListener>('BinanceListener').to(BinanceListener)
  iocContainer.get<BinanceListener>('BinanceListener').start()
}

/** Keep module-level references to prevent GC. */
const running: { stellar?: StellarListener, stellarConfidential?: StellarConfidentialListener } = {}

function stopListeners(): void {
  try {
    running.stellar?.stop()
    running.stellarConfidential?.stop()
  }
  finally {
    running.stellar = undefined
    running.stellarConfidential = undefined
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
