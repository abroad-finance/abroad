import { useTranslate } from '@tolgee/react'
import { ChevronsDown, CircleDollarSign, Landmark, Loader, QrCode, Timer, Wallet } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { lazy, Suspense } from 'react'

import { Button } from '../../shared/components/Button'
import { TokenBadge } from '../../shared/components/TokenBadge'
const IconAnimated = lazy(() => import('../../shared/components/IconAnimated').then(m => ({ default: m.IconAnimated })))
import { _36EnumsBlockchainNetwork as BlockchainNetwork, _36EnumsCryptoCurrency as CryptoCurrency, getQuote, getReverseQuote, _36EnumsPaymentMethod as PaymentMethod, _36EnumsTargetCurrency as TargetCurrency } from '../../api/index'
import { useWalletAuth } from '../../contexts/WalletAuthContext'
import { useDebounce } from '../../hooks'
import { kit } from '../../services/stellarKit'

// Define props for Swap component
interface SwapProps {
  initialSourceAmount?: string
  initialTargetAmount?: string
  onAmountsChange?: (params: {
    currency?: (typeof TargetCurrency)[keyof typeof TargetCurrency]
    src?: string
    tgt?: string
  }) => void
  onContinue: (
    quote_id: string,
    srcAmount: string,
    tgtAmount: string,
    targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  ) => void
  onWalletConnect?: () => void
  openQr: () => void // handler to open QR scanner
  quoteId: string
  setQuoteId: (id: string) => void
  sourceAmount: string
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  textColor?: string
}

const COP_TRANSFER_FEE = 0.0
const BRL_TRANSFER_FEE = 0.0

export default function Swap({
  onAmountsChange,
  onContinue,
  openQr,
  quoteId,
  setQuoteId,
  sourceAmount,
  targetAmount,
  targetCurrency,
  textColor = '#356E6A',
}: SwapProps) {
  const { t } = useTranslate()
  // Derived formatting and payment method by target currency
  const targetLocale = targetCurrency === TargetCurrency.BRL ? 'pt-BR' : 'es-CO'
  const targetSymbol = targetCurrency === TargetCurrency.BRL ? 'R$' : '$'
  const targetPaymentMethod = targetCurrency === TargetCurrency.BRL ? PaymentMethod.PIX : PaymentMethod.MOVII
  // Dynamic transfer fee: BRL = 0, COP = 1354
  const transferFee = targetCurrency === TargetCurrency.BRL ? BRL_TRANSFER_FEE : COP_TRANSFER_FEE

  const { authenticateWithWallet, token } = useWalletAuth()
  const [loadingSource, setLoadingSource] = useState(false)
  const [loadingTarget, setLoadingTarget] = useState(false)
  const [displayedTRM, setDisplayedTRM] = useState(0.000)
  // New: selected target currency (COP | BRL)
  // Dropdown state for currency selection
  const [currencyMenuOpen, setCurrencyMenuOpen] = useState(false)
  const currencyMenuRef = useRef<HTMLDivElement | null>(null)
  const sourceDebouncedAmount = useDebounce(sourceAmount, 1500) // 1000ms delay
  const targetDebounceAmount = useDebounce(targetAmount, 1500)
  const triggerRef = useRef<boolean | null>(null)

  const isButtonDisabled = () => {
    const numericSource = parseFloat(String(sourceAmount))
    // Clean targetAmount: remove thousands separators (.), change decimal separator (,) to .
    const cleanedTarget = String(targetAmount).replace(/\./g, '').replace(/,/g, '.')
    const numericTarget = parseFloat(cleanedTarget)
    return !(numericSource > 0 && numericTarget > 0)
  }

  const formatTargetNumber = useCallback((value: number) =>
    new Intl.NumberFormat(targetLocale, { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value), [targetLocale])

  const fetchDirectConversion = useCallback(async (value: string) => {
    const num = parseFloat(value)
    if (isNaN(num)) {
      onAmountsChange?.({ tgt: '' })
      return
    }
    setLoadingTarget(true)
    try {
      console.log('Fetching reverse quote for source amount:', num)
      const response = await getReverseQuote({
        crypto_currency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        payment_method: targetPaymentMethod,
        source_amount: num,
        target_currency: targetCurrency,
      })
      if (response.status === 200) {
        const formatted = formatTargetNumber(response.data.value)
        setQuoteId(response.data.quote_id) // Add this line
        onAmountsChange?.({ tgt: formatted })
      }
    }
    catch (error: unknown) {
      console.error('Reverse quote error', error)
    }
    finally {
      setLoadingTarget(false)
    }
  }, [
    onAmountsChange,
    formatTargetNumber,
    targetCurrency,
    targetPaymentMethod,
    setQuoteId,
  ])

  const fetchReverseConversion = useCallback(async (value: string) => {
    // allow digits, dots and commas; normalize commas to dots for parse
    const raw = value.replace(/[^0-9.,]/g, '')
    const normalized = raw.replace(/\./g, '').replace(/,/g, '.')
    const num = parseFloat(normalized)
    if (isNaN(num)) {
      onAmountsChange?.({ src: '' })
      return
    }
    setLoadingSource(true)
    try {
      console.log('Fetching direct quote for amount:', num)
      const response = await getQuote({
        amount: num,
        crypto_currency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        payment_method: targetPaymentMethod,
        target_currency: targetCurrency,
      })
      if (response.status === 200) {
        const src = response.data.value.toFixed(2)
        setQuoteId(response.data.quote_id)
        onAmountsChange?.({ src: src })
      }
    }
    catch (error: unknown) {
      console.error('Quote error', error)
    }
    finally {
      setLoadingSource(false)
    }
  }, [
    onAmountsChange,
    setQuoteId,
    targetCurrency,
    targetPaymentMethod,
  ])

  const handleSourceOnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    triggerRef.current = true
    onAmountsChange?.({ src: e.target.value.replace(/[^0-9.]/g, '') })
  }

  const handleTargetOnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    triggerRef.current = false
    onAmountsChange?.({ tgt: e.target.value.replace(/[^0-9.,]/g, '') })
  }

  // Direct wallet connection handler
  const handleDirectWalletConnect = () => {
    kit.openModal({
      onWalletSelected: async (option) => {
        authenticateWithWallet(option.id)
      },
    })
  }

  useEffect(() => {
    if (!loadingSource && !loadingTarget) {
      const numericSource = parseFloat(sourceAmount)
      // Normalize targetAmount (which might have formatting) to a standard number string for parsing
      const cleanedTarget = targetAmount.replace(/\./g, '').replace(/,/g, '.')
      const numericTarget = parseFloat(cleanedTarget)

      if (numericSource > 0 && !isNaN(numericTarget) && numericTarget >= 0) {
        setDisplayedTRM((numericTarget + transferFee) / numericSource)
      }
      else {
        setDisplayedTRM(0.000)
      }
    }
    // If loadingSource or loadingTarget is true, displayedTRM remains unchanged.
  }, [
    sourceAmount,
    targetAmount,
    loadingSource,
    loadingTarget,
    transferFee,
  ]) // TransferFee is a module-level const

  useEffect(() => {
    if (sourceDebouncedAmount && triggerRef.current === true) {
      fetchDirectConversion(sourceDebouncedAmount)
    }
  }, [fetchDirectConversion, sourceDebouncedAmount])

  useEffect(() => {
    if (targetDebounceAmount && triggerRef.current === false) {
      fetchReverseConversion(targetDebounceAmount)
    }
  }, [targetDebounceAmount, fetchReverseConversion])

  // Close currency dropdown on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (currencyMenuRef.current && !currencyMenuRef.current.contains(e.target as Node)) {
        setCurrencyMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  return (
    <div className="flex-1 flex items-center justify-center w-full flex flex-col">
      <div
        className="w-[90%] max-w-md min-h-[60vh] bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-4 md:p-6 flex flex-col items-center justify-center space-y-1 lg:space-y-4"
        id="background-container"
      >
        {/* Title */}
        <div className="flex-1 flex items-center justify-space-between">
          <div className="flex items-center gap-2 text-xl md:text-xl font-bold" id="Title" style={{ color: textColor }}>
            <span>{t('swap.title', '¿Cuánto deseas cambiar?')}</span>
            {targetCurrency === TargetCurrency.BRL && (
              <button
                aria-label={t('swap.scan_qr_aria', 'Escanear QR')}
                className="p-2 cursor-pointer rounded-full hover:bg-white/30 focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40 transition"
                onClick={openQr}
                type="button"
              >
                <QrCode className="w-6 h-6" style={{ color: textColor }} />
              </button>
            )}
          </div>
        </div>

        {/* SOURCE */}
        <div
          className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:py-6 md:px-6 flex items-center justify-between"
          id="source-amount"
        >
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="text-xl md:text-2xl font-bold shrink-0" style={{ color: textColor }}>$</span>
            {loadingSource
              ? (
                  <Loader className="animate-spin w-6 h-6" style={{ color: textColor }} />
                )
              : (
                  <input
                    className="w-full bg-transparent font-bold focus:outline-none text-xl md:text-2xl"
                    inputMode="decimal"
                    onChange={handleSourceOnChange}
                    pattern="[0-9.]*"
                    placeholder="0.00"
                    style={{ color: textColor }}
                    type="text"
                    value={sourceAmount}
                  />
                )}
          </div>
          <TokenBadge
            alt="USDC Token Logo"
            iconSrc="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
            symbol="USDC"
          />
        </div>

        {/* TARGET */}
        {token
          ? (
              <div
                className="relative w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:py-6 md:px-6 flex items-center justify-between"
                id="target-amount"
              >
                {/* chevrons */}
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 bg-[#356E6A]/5 rounded-full grid place-items-center">
                  <ChevronsDown className="w-4 h-4" color="#356E6A" />
                </div>

                {/* input */}
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <span className="text-xl md:text-2xl font-bold shrink-0" style={{ color: textColor }}>
                    {targetSymbol}
                  </span>
                  {loadingTarget
                    ? (
                        <Loader className="animate-spin w-6 h-6" style={{ color: textColor }} />
                      )
                    : (
                        <input
                          className="w-full bg-transparent font-bold focus:outline-none text-xl md:text-2xl"
                          inputMode="decimal"
                          onChange={handleTargetOnChange}
                          pattern="[0-9.,]*"
                          placeholder="0,00"
                          style={{ color: textColor }}
                          type="text"
                          value={targetAmount}
                        />
                      )}
                </div>

                {/* selector de moneda */}
                <div className="relative ml-2 shrink-0" ref={currencyMenuRef}>
                  <button
                    aria-expanded={currencyMenuOpen}
                    aria-haspopup="listbox"
                    className="focus:outline-none cursor-pointer"
                    onClick={() => setCurrencyMenuOpen(v => !v)}
                    type="button"
                  >
                    <TokenBadge
                      alt={`${targetCurrency} Flag`}
                      iconSrc={
                        targetCurrency === TargetCurrency.BRL
                          ? 'https://hatscripts.github.io/circle-flags/flags/br.svg'
                          : 'https://hatscripts.github.io/circle-flags/flags/co.svg'
                      }
                      symbol={targetCurrency}
                    />
                  </button>

                  {currencyMenuOpen && (
                    <div
                      className="absolute left-0 top-[calc(100%+8px)] z-50 bg-white/95 backdrop-blur-xl rounded-xl shadow-lg p-2 space-y-1 min-w-[100px]"
                      role="listbox"
                    >
                      <button
                        aria-selected={targetCurrency === TargetCurrency.COP}
                        className="w-full text-left hover:bg-black/5 rounded-lg px-1 py-1 cursor-pointer"
                        onClick={() => {
                          setCurrencyMenuOpen(false)
                          // Notify parent about currency change to update global state (e.g., background)
                          onAmountsChange?.({ currency: TargetCurrency.COP, src: sourceAmount, tgt: targetAmount })
                        }}
                        role="option"
                        type="button"
                      >
                        <TokenBadge
                          alt="Colombia flag"
                          iconSrc="https://hatscripts.github.io/circle-flags/flags/co.svg"
                          symbol="COP"
                        />
                      </button>

                      <button
                        aria-selected={targetCurrency === TargetCurrency.BRL}
                        className="cursor-pointer w-full text-left hover:bg-black/5 rounded-lg px-1 py-1"
                        onClick={() => {
                          setCurrencyMenuOpen(false)
                          // Notify parent about currency change to update global state (e.g., background)
                          onAmountsChange?.({ currency: TargetCurrency.BRL, src: sourceAmount, tgt: targetAmount })
                        }}
                        role="option"
                        type="button"
                      >
                        <TokenBadge
                          alt="Brazil flag"
                          iconSrc="https://hatscripts.github.io/circle-flags/flags/br.svg"
                          symbol="BRL"
                        />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          : (
              <div className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:py-6 md:px-6 flex items-center justify-center gap-4">
                <div className="flex-shrink-0">
                  <Suspense fallback={null}>
                    <IconAnimated icon="Denied" loop={false} play size={40} />
                  </Suspense>
                </div>
                <div className="flex flex-col space-y-1">
                  <span className="text-lg font-semibold" style={{ color: textColor }}>
                    {t('swap.connect_to_quote', 'Conecta tu billetera para poder cotizar')}
                  </span>
                </div>
              </div>
            )}

        <div className="flex-1 flex items-center justify-center w-full">
          <div className="w-full" id="tx-info" style={{ color: textColor }}>
            <div className="flex flex-col space-y-2">
              <div className="flex items-center space-x-2" id="trm">
                <CircleDollarSign className="w-5 h-5" />
                <span>
                  {t('swap.exchange_rate', 'Tasa de Cambio:')}
                  <b>{displayedTRM === 0 ? '-' : `${targetSymbol}${formatTargetNumber(displayedTRM)}`}</b>
                </span>
              </div>
              <div className="flex items-center space-x-2" id="transfer-fee">
                <Landmark className="w-5 h-5" />
                <span>
                  {t('swap.transfer_cost', 'Costo de Transferencia:')}
                  <b>
                    {targetSymbol}
                    {formatTargetNumber(transferFee)}
                  </b>
                </span>
              </div>
              <div className="flex items-center space-x-2" id="time">
                <Timer className="w-5 h-5" />
                <span>
                  {t('swap.time', 'Tiempo:')}
                  <b>{t('swap.time_value', '10 - 30 segundos')}</b>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Button
        className="mt-4 w-[90%] max-w-md py-4 cursor-pointer"
        disabled={!!token && (isButtonDisabled() || !quoteId)}
        onClick={() => {
          if (!token) {
            // Always use direct wallet connection - prioritize the internal handler
            handleDirectWalletConnect()
          }
          else {
            console.log('Continue clicked with quote_id:', quoteId)
            if (!quoteId) {
              alert(t('swap.wait_for_quote', 'Please wait for the quote to load before continuing'))
              return
            }
            onContinue(quoteId, sourceAmount, targetAmount, targetCurrency)
          }
        }}
      >
        {!token
          ? (
              <div className="flex items-center justify-center space-x-2">
                <Wallet className="w-5 h-5" />
                <span>{t('swap.connect_wallet', 'Conectar Billetera')}</span>
              </div>
            )
          : (
              t('swap.continue', 'Continuar')
            )}
      </Button>
    </div>
  )
}
