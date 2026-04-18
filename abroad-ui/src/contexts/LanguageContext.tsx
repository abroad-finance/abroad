import {
  BackendFetch, DevTools, FormatSimple, LanguageDetector, LanguageStorage, Tolgee,
} from '@tolgee/react'

const isStandalone = import.meta.env.VITE_STANDALONE_UI === 'true'

export const tolgee = Tolgee()
  .use(isStandalone ? undefined : DevTools())
  .use(FormatSimple())
  .use(BackendFetch({ prefix: 'https://storage.googleapis.com/tolgee-cd-bucket/2e0e6ec0908462504864b33aed3a6846' }))
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
  })
