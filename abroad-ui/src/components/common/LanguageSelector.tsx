import { useTolgee, useTranslate } from '@tolgee/react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

interface LanguageSelectorProps {
  className?: string
  variant?: 'desktop' | 'mobile'
}

// Centralized language change logic
const LanguageSelector: React.FC<LanguageSelectorProps> = ({ className = '', variant = 'desktop' }) => {
  const tolgee = useTolgee()
  const { t } = useTranslate()

  const languages = useMemo(() => {
    const opts = (tolgee as unknown as { getInitialOptions?: () => { availableLanguages?: string[] } })?.getInitialOptions?.()
    return opts?.availableLanguages || ['pt', 'es', 'en', 'ru']
  }, [tolgee])

  const [currentLang, setCurrentLang] = useState(() => {
    return tolgee.getLanguage()
  })

  // Subscribe to language change events so the selector updates immediately
  useEffect(() => {
    const off = tolgee.on?.('language', (l: { value: string }) => {
      setCurrentLang(l.value)
    })
    return () => {
      off?.unsubscribe()
    }
  }, [tolgee])

  const changeLanguage = useCallback((lng: string) => {
    try {
      tolgee.changeLanguage(lng)
      // Optimistic update in case event is delayed
      setCurrentLang(lng)
    }
    catch { /* silently ignore */ }
  }, [tolgee])

  const styles = variant === 'mobile'
    ? 'appearance-none bg-[#356E6A]/5 border border-white/30 text-[#356E6A] text-xs font-medium px-2 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40'
    : 'appearance-none bg-white/20 text-white text-sm font-medium px-3 py-2 pr-8 rounded-xl focus:outline-none focus:ring-2 focus:ring-white/40 hover:bg-white/30 cursor-pointer'

  const caret = variant === 'mobile'
    ? 'pointer-events-none absolute inset-y-0 right-2 flex items-center text-[#356E6A] text-[10px]'
    : 'pointer-events-none absolute inset-y-0 right-2 flex items-center text-white text-xs'

  return (
    <div className={`relative ${className}`}>
      <select
        aria-label={t('navbar.language_selector_aria', 'Seleccionar idioma')}
        className={styles}
        onChange={e => changeLanguage(e.target.value)}
        value={currentLang}
      >
        {languages.map((l: string) => (
          <option className={variant === 'mobile' ? 'text-black' : 'text-black'} key={l} value={l}>
            {l.toUpperCase()}
          </option>
        ))}
      </select>
      <span className={caret}>▼</span>
    </div>
  )
}

export default LanguageSelector
