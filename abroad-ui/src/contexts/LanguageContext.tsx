import {
  BackendFetch, DevTools, FormatSimple, LanguageDetector, LanguageStorage, Tolgee,
} from '@tolgee/react'

const isStandalone = import.meta.env.VITE_STANDALONE_UI === 'true'

export const tolgee = Tolgee()
  .use(isStandalone ? undefined : DevTools())
  .use(FormatSimple())
  .use(BackendFetch({ fallbackOnFail: true, prefix: '/i18n' }))
  .use(LanguageDetector())
  .use(LanguageStorage())
  .init({
    apiKey: isStandalone ? undefined : import.meta.env.VITE_APP_TOLGEE_API_KEY,
    apiUrl: isStandalone ? undefined : import.meta.env.VITE_APP_TOLGEE_API_URL,
    availableLanguages: [
      'pt',
      'es',
      'en',
      'ru',
    ],
    defaultLanguage: 'en',
    // English copy is the typed fallback colocated with each consumer surface.
    // Registering an empty local catalog prevents a failed `/i18n/en.json`
    // request while keeping those source-controlled fallbacks authoritative.
    staticData: { en: {} },
  })
