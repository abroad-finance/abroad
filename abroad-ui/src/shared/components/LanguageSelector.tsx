// components/common/LanguageSelector.tsx
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import React from 'react'
import { createPortal } from 'react-dom'

export interface LanguageSelectorProps {
  ariaLabel?: string
  className?: string
  /** Controlled draft selection inside the modal */
  draft: string
  /** Text labels overrides */
  labels?: {
    closeAria?: string
    confirm?: string
    hint?: string
    subtitle?: string
    title?: string
  }
  languages: string[]
  /** Optional custom mapping for code -> { name, flag } */
  metaMap?: Record<string, { flag: string
    name: string }>
  /** Committed language value + change callback */
  onChange: (lng: string) => void
  onDraftChange: (lng: string) => void
  onOpenChange: (open: boolean) => void
  /** Controlled open state for the side modal */
  open: boolean
  value: string
  /** Desktop vs mobile trigger styling */
  variant?: 'desktop' | 'mobile'
}

const DEFAULT_META: Record<string, { flag: string
  name: string }> = {
    ar: {
      flag: 'sa',
      name: 'العربية',
    },
    en: {
      flag: 'gb',
      name: 'English',
    },
    es: {
      flag: 'es',
      name: 'Español',
    },
    pt: {
      flag: 'br',
      name: 'Português',
    },
    ru: {
      flag: 'ru',
      name: 'Русский',
    },
    zh: {
      flag: 'cn',
      name: '中文',
    },
  }

const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  ariaLabel,
  className = '',
  draft,
  labels,
  languages,
  metaMap = DEFAULT_META,
  onChange,
  onDraftChange,
  onOpenChange,
  open,
  value,
  variant = 'desktop',
}) => {
  const currentMeta = metaMap[value] || {
    flag: value,
    name: value.toUpperCase(),
  }

  // Fallbacks (hook can override via `labels`)
  const title = labels?.title ?? 'Configuración de Idioma'
  const subtitle
    = labels?.subtitle ?? 'Selecciona tu idioma preferido para la interfaz'
  const confirmLabel = labels?.confirm ?? 'Confirmar Selección'
  const hint
    = labels?.hint ?? 'Los cambios de idioma se aplicarán inmediatamente'
  const closeAria = labels?.closeAria ?? 'Cerrar'
  const selectLanguageAria = ariaLabel ?? 'Seleccionar idioma'

  const triggerClasses
    = variant === 'mobile'
      ? 'flex items-center gap-1 bg-[#356E6A]/5 border border-white/30 text-[#356E6A] text-xs font-medium px-2 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40 hover:bg-[#356E6A]/10'
      : 'flex items-center gap-2 bg-white/20 text-white text-sm font-medium px-3 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-white/40 hover:bg-white/30 cursor-pointer'

  const handleConfirm = () => {
    if (draft !== value) onChange(draft)
    onOpenChange(false)
  }

  return (
    <>
      {/* Trigger */}
      <button
        aria-label={selectLanguageAria}
        className={`${triggerClasses} ${className}`}
        onClick={() => onOpenChange(true)}
        type="button"
      >
        <img
          alt={currentMeta.name}
          className="w-5 h-5 rounded-full"
          loading="lazy"
          src={`https://hatscripts.github.io/circle-flags/flags/${currentMeta.flag}.svg`}
        />
        <span className="hidden md:inline">{currentMeta.name}</span>
      </button>

      {/* Side Modal - Portal to document body level */}
      {createPortal(
        <AnimatePresence>
          {open && (
            <div
              aria-label={title}
              aria-modal="true"
              className="fixed inset-0 z-[9999] flex justify-end items-end md:items-center md:pr-4"
              role="dialog"
            >
              {/* Backdrop - covers entire viewport */}
              <div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={() => onOpenChange(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') onOpenChange(false)
                }}
                role="button"
                tabIndex={0}
              />
              {/* Panel */}
              <motion.div
                animate={{
                  opacity: 1,
                  x: 0,
                  y: 0,
                }}
                className="w-screen md:w-auto md:mx-0 md:ml-auto md:max-w-md md:flex md:items-center fixed md:relative left-0 md:left-auto top-auto md:top-auto bottom-0 md:bottom-auto h-[80vh] md:h-[95vh] z-[10000]"
                exit={{
                  opacity: typeof window !== 'undefined' && window.innerWidth >= 768 ? 1 : 0,
                  x: typeof window !== 'undefined' && window.innerWidth >= 768 ? '100%' : 0,
                  y: typeof window !== 'undefined' && window.innerWidth >= 768 ? 0 : '100%',
                }}
                initial={{
                  opacity: 1,
                  x: typeof window !== 'undefined' && window.innerWidth >= 768 ? '100%' : 0,
                  y: typeof window !== 'undefined' && window.innerWidth >= 768 ? 0 : '100%',
                }}
                transition={{
                  damping: 30,
                  mass: 0.8,
                  stiffness: 300,
                  type: 'spring',
                }}
              >
                <div className="bg-white rounded-t-4xl md:rounded-4xl shadow-lg border border-gray-200 p-3 md:p-4 relative w-full h-full flex flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)]">
                  <button
                    aria-label={closeAria}
                    className="absolute top-4 right-4 p-1 rounded-full hover:bg-gray-100 transition-colors duration-200 cursor-pointer z-10"
                    onClick={() => onOpenChange(false)}
                  >
                    <X className="w-5 h-5 text-gray-400 hover:text-gray-600" />
                  </button>
                  {/* Header */}
                  <div className="mb-6 pr-8 text-center mt-2 md:mt-4">
                    <h2 className="text-2xl font-semibold text-gray-900">{title}</h2>
                    <p className="text-md text-gray-600">{subtitle}</p>
                  </div>
                  {/* Language Options */}
                  <div className="flex-1">
                    <div className="space-y-3">
                      {languages.map((code) => {
                        const meta
                          = metaMap[code] || {
                            flag: code,
                            name: code.toUpperCase(),
                          }
                        const selected = draft === code
                        return (
                          <button
                            className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all duration-200 hover:bg-gray-50 ${
                              selected
                                ? 'border-[#356E6A] bg-[#356E6A]/10'
                                : 'border-gray-200 bg-white'
                            }`}
                            key={code}
                            onClick={() => onDraftChange(code)}
                            type="button"
                          >
                            <div className="flex items-center space-x-4">
                              <img
                                alt={`${meta.name} flag`}
                                className="w-6 h-6 rounded-full flex-shrink-0"
                                loading="lazy"
                                src={`https://hatscripts.github.io/circle-flags/flags/${meta.flag}.svg`}
                              />
                              <span className="text-gray-800 font-medium text-lg">
                                {meta.name}
                              </span>
                            </div>
                            <div
                              className={`w-5 h-5 rounded-full border-2 transition-all duration-200 ${
                                selected ? 'border-[#356E6A] bg-[#356E6A]' : 'border-gray-300'
                              }`}
                            >
                              {selected && (
                                <div className="w-full h-full flex items-center justify-center">
                                  <div className="w-2 h-2 bg-white rounded-full" />
                                </div>
                              )}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  {/* Confirmation Button */}
                  <div className="mt-6">
                    <button
                      className="bg-gradient-to-r from-[#356E6A] to-[#73B9A3] hover:from-[#2a5956] hover:to-[#5fa88d] text-white cursor-pointer text-lg font-medium rounded-xl w-full p-4 transition"
                      onClick={handleConfirm}
                      type="button"
                    >
                      {confirmLabel}
                    </button>
                  </div>
                  {/* Footer */}
                  <div className="text-xs text-gray-500 leading-relaxed text-center mt-6 pt-4 border-t border-gray-200">
                    {hint}
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}

export default LanguageSelector
