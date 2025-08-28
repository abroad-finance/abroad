// hooks/useLanguageSelector.ts
import { useTolgee, useTranslate } from '@tolgee/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { LanguageSelectorProps } from '../shared/components/LanguageSelector'

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
    closeAria: t('language_selector.actions.close', 'Cerrar'),
    confirm: t('language_selector.actions.confirm', 'Confirmar Selección'),
    hint: t(
      'language_selector.footer.hint',
      'Los cambios de idioma se aplicarán inmediatamente',
    ),
    subtitle: t(
      'language_selector.header.subtitle',
      'Selecciona tu idioma preferido para la interfaz',
    ),
    title: t('language_selector.header.title', 'Configuración de Idioma'),
  }

  const _aria = t('language_selector.trigger.aria_label', 'Seleccionar idioma')
  const ariaLabel
    = typeof _aria === 'string' && _aria.length > 0 ? _aria : 'Seleccionar idioma'

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
