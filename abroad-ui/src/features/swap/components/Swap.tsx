import { useTranslate } from '@tolgee/react'
import {
  ChevronsDown,
  CircleDollarSign,
  Landmark,
  Loader,
  ScanLine,
  Timer,
  Wallet,
} from 'lucide-react'
import React, { lazy, Suspense } from 'react'

import { Button } from '../../../shared/components/Button'
import { TokenBadge } from '../../../shared/components/TokenBadge'
const IconAnimated = lazy(() =>
  import('../../../shared/components/IconAnimated').then(m => ({ default: m.IconAnimated })),
)

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'

export interface SwapProps {
  continueDisabled: boolean
  currencyMenuOpen: boolean
  currencyMenuRef: React.RefObject<HTMLDivElement | null>
  exchangeRateDisplay: string // e.g. '-', 'R$5,43'
  isAuthenticated: boolean
  loadingSource: boolean
  loadingTarget: boolean
  onPrimaryAction: () => void
  onSourceChange: (value: string) => void
  onTargetChange: (value: string) => void
  openQr: () => void
  selectCurrency: (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => void
  sourceAmount: string
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  targetSymbol: string
  textColor?: string
  toggleCurrencyMenu: () => void
  transferFeeDisplay: string // e.g. 'R$0,00'
}

export default function Swap({
  continueDisabled,
  currencyMenuOpen,
  currencyMenuRef,
  exchangeRateDisplay,
  isAuthenticated,
  loadingSource,
  loadingTarget,
  onPrimaryAction,
  onSourceChange,
  onTargetChange,
  openQr,
  selectCurrency,
  sourceAmount,
  targetAmount,
  targetCurrency,
  targetSymbol,
  textColor = '#356E6A',
  toggleCurrencyMenu,
  transferFeeDisplay,
}: SwapProps): React.JSX.Element {
  const { t } = useTranslate()

  return (
    <div className="flex-1 flex items-center justify-center w-full flex flex-col">
      <div
        className="w-[98%] max-w-md min-h-[60vh] bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-4 md:p-6 flex flex-col items-center justify-center space-y-1 lg:space-y-4"
        id="background-container"
      >
        {/* Title + Subtitle */}
        <div className="flex-1 flex items-center justify-between w-full">
          <div className="flex flex-col">
            <div className="text-xl md:text-xl font-bold" style={{ color: textColor }}>
              <span>{t('swap.title', 'Paga o Transfiere')}</span>
            </div>
            {targetCurrency === TargetCurrency.BRL && (
              <div className="text-xs md:text-sm opacity-75" style={{ color: textColor }}>
                {t('swap.subtitle', 'Escribe los datos o escanea un QR de Pix')}
              </div>
            )}
          </div>

          {targetCurrency === TargetCurrency.BRL && (
            <button
              aria-label={t('swap.scan_qr_aria', 'Escanear QR')}
              className="p-2 cursor-pointer rounded-full hover:bg-white/30 focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40 transition"
              onClick={openQr}
              type="button"
            >
              <ScanLine className="w-8 h-8" style={{ color: textColor }} />
            </button>
          )}
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
                    onChange={e => onSourceChange(e.target.value)}
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

        {/* TARGET or Connect notice */}
        {isAuthenticated
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
                          onChange={e => onTargetChange(e.target.value)}
                          pattern="[0-9.,]*"
                          placeholder="0,00"
                          style={{ color: textColor }}
                          type="text"
                          value={targetAmount}
                        />
                      )}
                </div>

                {/* currency selector */}
                <div className="relative ml-2 shrink-0" ref={currencyMenuRef}>
                  <button
                    aria-expanded={currencyMenuOpen}
                    aria-haspopup="listbox"
                    className="focus:outline-none cursor-pointer"
                    onClick={toggleCurrencyMenu}
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
                        onClick={() => selectCurrency(TargetCurrency.COP)}
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
                        onClick={() => selectCurrency(TargetCurrency.BRL)}
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

        {/* Info */}
        <div className="flex-1 flex items-center justify-center w-full">
          <div className="w-full" id="tx-info" style={{ color: textColor }}>
            <div className="flex flex-col space-y-2">
              <div className="flex items-center space-x-2" id="trm">
                <CircleDollarSign className="w-5 h-5" />
                <span>
                  {t('swap.exchange_rate', 'Tasa de Cambio:')}
                  {' '}
                  <b>{exchangeRateDisplay}</b>
                </span>
              </div>
              <div className="flex items-center space-x-2" id="transfer-fee">
                <Landmark className="w-5 h-5" />
                <span>
                  {t('swap.transfer_cost', 'Costo de Transferencia:')}
                  {' '}
                  <b>{transferFeeDisplay}</b>
                </span>
              </div>
              <div className="flex items-center space-x-2" id="time">
                <Timer className="w-5 h-5" />
                <span>
                  {t('swap.time', 'Tiempo:')}
                  {' '}
                  <b>{t('swap.time_value', '10 - 30 segundos')}</b>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Primary button (connect or continue) */}
      <Button
        className="mt-4 w-[98%] max-w-md py-4 cursor-pointer"
        disabled={continueDisabled}
        onClick={onPrimaryAction}
      >
        {!isAuthenticated
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
