import { BackendFetch, DevTools, FormatSimple, Tolgee } from '@tolgee/react'

export const tolgee = Tolgee()
  .use(DevTools())
  .use(FormatSimple())
  .use(BackendFetch({ prefix: 'https://storage.googleapis.com/tolgee-cd-bucket/2e0e6ec0908462504864b33aed3a6846' }))
  .init({
    apiKey: import.meta.env.VITE_APP_TOLGEE_API_KEY,
    apiUrl: import.meta.env.VITE_APP_TOLGEE_API_URL,
    availableLanguages: ['pt', 'es', 'en', 'ru'],
    defaultLanguage: 'pt',

  })
