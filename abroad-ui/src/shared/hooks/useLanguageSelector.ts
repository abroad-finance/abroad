// hooks/useLanguageSelector.ts
import { useTolgee, useTranslate } from '@tolgee/react'
import {
  useCallback, useEffect, useMemo, useState,
} from 'react'

import type { LanguageSelectorProps } from '../components/LanguageSelector'

/**
 * useLanguageSelector
 * Returns a fully controlled prop object for <LanguageSelector />.
 * The return type is exactly LanguageSelectorProps, so you can do:
 *   const props = useLanguageSelector()
 *   <LanguageSelector {...props} />
 */
export const useLanguageSelector = (): LanguageSelectorProps => {
  const tolgee = useTolgee()
  const { t } = useTranslate()

  // Available languages from Tolgee (fallback list if missing)
  const languages = useMemo(() => {
    const opts = (tolgee as unknown as { getInitialOptions?: () => { availableLanguages?: string[] } })
      ?.getInitialOptions?.()
    return opts?.availableLanguages || [
      'pt',
      'es',
      'en',
      'ru',
    ]
  }, [tolgee])

  // Committed language value + live sync with Tolgee (force non-undefined)
  const [value, setValue] = useState<string>(() => tolgee.getLanguage() || 'en')

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const off = (tolgee as any).on?.(
      'language',
      (l: { value?: string }) => setValue(l.value || 'en'),
    )
    return () => off?.unsubscribe?.()
  }, [tolgee])

  const onChange = useCallback(
    (lng: string) => {
      try {
        tolgee.changeLanguage(lng)
        setValue(lng) // optimistic
      }
      catch {
        /* noop */
      }
    },
    [tolgee],
  )

  // Controlled modal state
  const [open, setOpen] = useState(false)

  // Controlled draft selection inside the modal
  const [draft, setDraft] = useState<string>(value)
  useEffect(() => {
    setDraft(value)
  }, [value])

  // Labels & aria (resolved via i18n here so the component stays dumb)
  const labels = {
    closeAria: t('language_selector.actions.close', 'Close'),
    confirm: t('language_selector.actions.confirm', 'Confirm Selection'),
    hint: t(
      'language_selector.footer.hint',
      'Language changes will be applied immediately',
    ),
    subtitle: t(
      'language_selector.header.subtitle',
      'Select your preferred interface language',
    ),
    title: t('language_selector.header.title', 'Language Settings'),
  }

  const _aria = t('language_selector.trigger.aria_label', 'Select language')
  const ariaLabel
    = typeof _aria === 'string' && _aria.length > 0 ? _aria : 'Select language'

  return {
    ariaLabel,
    draft,
    labels,
    languages,
    onChange,
    onDraftChange: setDraft,
    onOpenChange: setOpen,
    open,
    value,
  }
}
