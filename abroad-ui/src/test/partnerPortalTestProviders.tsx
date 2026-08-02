import type { ReactNode } from 'react'

import { FormatSimple, Tolgee, TolgeeProvider } from '@tolgee/react'

const testTolgee = Tolgee()
  .use(FormatSimple())
  .init({
    availableLanguages: ['en'],
    defaultLanguage: 'en',
    language: 'en',
    staticData: { en: {} },
  })

export const PartnerPortalTestProviders = ({ children }: { children: ReactNode }) => (
  <TolgeeProvider tolgee={testTolgee}>{children}</TolgeeProvider>
)
