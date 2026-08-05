import { useCallback, useState } from 'react'

import type { OnrampQuoteSnapshot, PaymentInstructions } from '../model/onrampQuote'

import { classifyQuoteFailure, type QuoteIssue } from '../model/quote'
import { acceptOnrampTransaction, requestOnrampQuote } from '../services/onrampApi'

export type OnrampPurchaseState = {
  instructions: null | PaymentInstructions
  isSubmitting: boolean
  issue: null | QuoteIssue
  kycRequired: boolean
  quote: null | OnrampQuoteSnapshot
  transactionId: null | string
}

type StartPurchaseParams = {
  cryptoCurrency: 'USDC' | 'USDT'
  destinationAddress: string
  fiatAmount: number
  network: string
  userId: string
}

const IDLE: OnrampPurchaseState = {
  instructions: null,
  isSubmitting: false,
  issue: null,
  kycRequired: false,
  quote: null,
  transactionId: null,
}

/**
 * Owns one fiat-to-crypto purchase: price it, accept it, and hold the code the
 * customer pays.
 *
 * Quote and acceptance run back to back on purpose. An onramp quote is only
 * useful once it has a payable code attached, and splitting the two would leave
 * the customer holding a price they cannot act on.
 */
export const useOnrampPurchase = () => {
  const [state, setState] = useState<OnrampPurchaseState>(IDLE)

  const reset = useCallback(() => {
    setState(IDLE)
  }, [])

  const startPurchase = useCallback(async (params: StartPurchaseParams) => {
    setState({ ...IDLE, isSubmitting: true })

    const quoteResult = await requestOnrampQuote({
      cryptoCurrency: params.cryptoCurrency,
      fiatAmount: params.fiatAmount,
      network: params.network,
    })
    if (!quoteResult.ok) {
      setState({ ...IDLE, issue: classifyQuoteFailure(quoteResult) })
      return
    }

    const acceptResult = await acceptOnrampTransaction({
      destinationAddress: params.destinationAddress,
      quoteId: quoteResult.data.id,
      userId: params.userId,
    })
    if (!acceptResult.ok) {
      setState({
        ...IDLE,
        issue: classifyQuoteFailure(acceptResult),
        quote: quoteResult.data,
      })
      return
    }

    setState({
      instructions: acceptResult.data.paymentInstructions,
      isSubmitting: false,
      issue: null,
      kycRequired: acceptResult.data.kycRequired,
      quote: quoteResult.data,
      transactionId: acceptResult.data.transactionId,
    })
  }, [])

  return { reset, startPurchase, state }
}
