import mitt, { Emitter } from 'mitt'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../api'

// Descriptive, cause-based events for the Swap flow
// Each event type is emitted by a single source.
export type SwapEvents = {
  // Bank details inputs (separate per cause)
  'bankDetails/kycInputsRestored': { pixKey?: string, taxId?: string } // single source: useBankDetailsRoute
  'bankDetails/pixKeyChanged': { value: string } // single source: useBankDetailsRoute
  'bankDetails/taxIdChanged': { value: string } // single source: useBankDetailsRoute
  'swap/amountsRestoredFromPending': {
    quoteId?: string
    srcAmount?: string
    targetCurrency?: (typeof TargetCurrency)[keyof typeof TargetCurrency]
    tgtAmount?: string
  } // single source: controller

  // Controller-driven navigation (single source: controller)
  'swap/backToSwapRequested': void
  // User interactions (single source: useSwap)
  'swap/continueRequested': void

  'swap/kycRequired': void
  'swap/newTransactionRequested': void
  'swap/qrDecoded': { amount?: string, pixKey?: string, taxId?: string } // single source: controller

  // QR flow
  'swap/qrOpenRequestedByUser': void // single source: useSwap
  'swap/qrOpenRequestedFromUrlParam': void // single source: controller
  'swap/quoteFromQrCalculated': { quoteId: string, srcAmount: string } // single source: controller
  // Quotes & amounts (separate per cause)
  'swap/quoteFromSourceCalculated': { quoteId: string, targetAmount: string } // single source: useSwap

  'swap/quoteFromTargetCalculated': { quoteId: string, srcAmount: string } // single source: useSwap
  'swap/targetCurrencySelected': { currency: (typeof TargetCurrency)[keyof typeof TargetCurrency] }
  // Target currency forced by URL param (single source: controller)
  'swap/targetCurrencySetFromUrlParam': { currency: (typeof TargetCurrency)[keyof typeof TargetCurrency] }

  'swap/transactionSigned': { transactionId: null | string }
  'swap/userSourceInputChanged': { value: string }
  'swap/userTargetInputChanged': { value: string }

  // Signing / transactions / KYC (single source: useBankDetailsRoute)
  'swap/walletSigningStarted': void
}

export const swapBus: Emitter<SwapEvents> = mitt<SwapEvents>()
