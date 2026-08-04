import { X } from 'lucide-react'
import React, {
  useId,
  useState,
} from 'react'

import { BRAND_TITLE_CLASS } from '../constants'
import { cn } from '../utils'
import { ModalSurface } from './ModalSurface'

export interface LanguageSelectorProps {
  ariaLabel?: string
  className?: string
  draft: string
  labels?: {
    changeError?: string
    closeAria?: string
    confirm?: string
    hint?: string
    subtitle?: string
    title?: string
  }
  languages: string[]
  metaMap?: Record<string, { flag: string, name: string }>
  onChange: (language: string) => Promise<boolean>
  onDraftChange: (language: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  value: string
  variant?: 'desktop' | 'mobile'
}

const DEFAULT_META: Record<string, { flag: string, name: string }> = {
  ar: { flag: 'sa', name: 'العربية' },
  en: { flag: 'gb', name: 'English' },
  es: { flag: 'es', name: 'Español' },
  pt: { flag: 'br', name: 'Português' },
  ru: { flag: 'ru', name: 'Русский' },
  zh: { flag: 'cn', name: '中文' },
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
  const descriptionId = useId()
  const titleId = useId()
  const [changeFailed, setChangeFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const currentMeta = metaMap[value] ?? { flag: value, name: value.toUpperCase() }
  const title = labels?.title ?? 'Language settings'
  const subtitle = labels?.subtitle ?? 'Select your preferred interface language'
  const confirmLabel = labels?.confirm ?? 'Confirm selection'
  const hint = labels?.hint ?? 'The selected language applies across Abroad.'
  const closeAria = labels?.closeAria ?? 'Close'
  const selectLanguageAria = ariaLabel ?? 'Select language'
  const triggerClasses = variant === 'mobile'
    ? 'flex min-h-11 items-center gap-2 rounded-xl border border-white/30 bg-abroad-dark/5 px-3 py-2 text-xs font-medium text-abroad-dark hover:bg-abroad-dark/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-abroad-dark/40'
    : 'flex min-h-11 items-center gap-2 rounded-xl bg-white/20 px-3 py-2 text-sm font-medium hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40'

  const close = (): void => {
    if (submitting) return
    setChangeFailed(false)
    onDraftChange(value)
    onOpenChange(false)
  }

  const handleConfirm = async (): Promise<void> => {
    if (submitting) return
    if (draft === value) {
      onOpenChange(false)
      return
    }
    setSubmitting(true)
    setChangeFailed(false)
    const changed = await onChange(draft)
    setSubmitting(false)
    if (changed) onOpenChange(false)
    else setChangeFailed(true)
  }

  return (
    <>
      <button
        aria-label={selectLanguageAria}
        className={cn(triggerClasses, className)}
        onClick={() => onOpenChange(true)}
        type="button"
      >
        <img alt="" aria-hidden="true" className="size-5 rounded-full" loading="lazy" src={`https://hatscripts.github.io/circle-flags/flags/${currentMeta.flag}.svg`} />
        <span className={cn('hidden md:inline', variant === 'desktop' && BRAND_TITLE_CLASS)}>{currentMeta.name}</span>
      </button>

      <ModalSurface descriptionId={descriptionId} onClose={close} open={open} titleId={titleId}>
        <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-ab-border bg-[var(--ab-bg-card)] shadow-2xl">
          <header className="flex items-start justify-between gap-4 border-b border-ab-border p-5">
            <div>
              <h2 className="text-xl font-bold text-ab-text" id={titleId}>{title}</h2>
              <p className="mt-1 text-sm text-ab-text-3" id={descriptionId}>{subtitle}</p>
            </div>
            <button
              aria-label={closeAria}
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--ab-bg-muted)] text-ab-text-3 hover:text-ab-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)]"
              data-modal-initial-focus
              onClick={close}
              type="button"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </header>

          <fieldset className="min-h-0 overflow-y-auto p-4">
            <legend className="sr-only">{subtitle}</legend>
            <div className="space-y-2">
              {languages.map((code) => {
                const meta = metaMap[code] ?? { flag: code, name: code.toUpperCase() }
                const selected = draft === code
                return (
                  <label
                    className={cn(
                      'flex min-h-14 cursor-pointer items-center gap-4 rounded-2xl border p-4 transition-colors',
                      selected
                        ? 'border-[var(--ab-green)] bg-[var(--ab-green)]/10'
                        : 'border-ab-border bg-[var(--ab-bg-subtle)] hover:bg-[var(--ab-bg-muted)]',
                    )}
                    key={code}
                  >
                    <input
                      checked={selected}
                      className="size-5 accent-[var(--ab-green)]"
                      name="interface-language"
                      onChange={() => onDraftChange(code)}
                      type="radio"
                      value={code}
                    />
                    <img alt="" aria-hidden="true" className="size-6 rounded-full" loading="lazy" src={`https://hatscripts.github.io/circle-flags/flags/${meta.flag}.svg`} />
                    <span className="text-base font-semibold text-ab-text">{meta.name}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          <footer className="border-t border-ab-border p-4">
            {changeFailed && <p className="mb-3 text-sm font-semibold text-ab-error" role="alert">{labels?.changeError ?? 'The language could not be changed. Try again.'}</p>}
            <button
              aria-busy={submitting}
              className="min-h-12 w-full rounded-xl bg-ab-btn px-4 text-base font-semibold text-ab-btn-text disabled:opacity-60"
              disabled={submitting}
              onClick={() => void handleConfirm()}
              type="button"
            >
              {submitting ? 'Changing language…' : confirmLabel}
            </button>
            <p className="mt-3 text-center text-xs text-ab-text-3">{hint}</p>
          </footer>
        </div>
      </ModalSurface>
    </>
  )
}

export default LanguageSelector
