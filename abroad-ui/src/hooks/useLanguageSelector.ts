import { useTolgee, useTranslate } from '@tolgee/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { LanguageSelectorProps } from '../components/common/LanguageSelector'

/**
 * useLanguageSelector
 * Encapsulates Tolgee language selection logic (available languages discovery,
 * current language subscription, optimistic change handler & aria label).
 */
export type UseLanguageSelectorResult = Pick<LanguageSelectorProps, 'ariaLabel' | 'languages' | 'onChange' | 'value'> & {
  // Keeping extensibility for future (e.g., loading state) without changing component API
}

export const useLanguageSelector = (): UseLanguageSelectorResult => {
  const tolgee = useTolgee()
  const { t } = useTranslate()

  // Resolve available languages from initial options (fallback to a safe list)
  const languages = useMemo(() => {
    const opts = (tolgee as unknown as { getInitialOptions?: () => { availableLanguages?: string[] } })?.getInitialOptions?.()
    return opts?.availableLanguages || ['pt', 'es', 'en', 'ru']
  }, [tolgee])

  const [value, setValue] = useState(() => tolgee.getLanguage())

  // Keep state in sync with external language changes
  useEffect(() => {
  // eslint-disable-next-line
  const off = tolgee.on?.('language', (l: { value: string }) => setValue(l.value))
    return () => off?.unsubscribe()
  }, [tolgee])

  const onChange = useCallback((lng: string) => {
    try {
      tolgee.changeLanguage(lng)
      setValue(lng) // optimistic update
    }
    catch {
      /* noop */
    }
  }, [tolgee])

  const _aria = t('navbar.language_selector_aria', 'Seleccionar idioma')
  const ariaLabel: string = typeof _aria === 'string' && _aria.length > 0 ? _aria : 'Seleccionar idioma'

  return { ariaLabel, languages, onChange, value } as UseLanguageSelectorResult
}
