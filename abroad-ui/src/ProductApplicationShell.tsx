import { TolgeeProvider } from '@tolgee/react'
import { Outlet } from 'react-router-dom'

import { tolgee } from './contexts/LanguageContext'
import { NoticeProvider } from './contexts/NoticeContext'
import { WalletAuthProvider } from './contexts/WalletAuthProvider'
import { WebSocketProvider } from './contexts/WebSocketContext'
import { ConnectionStatusBanner } from './shared/components/ConnectionStatusBanner'
import HiddenLogViewer from './shared/components/HiddenLogViewer'

const ProductApplicationShell = () => (
  <TolgeeProvider tolgee={tolgee}>
    <NoticeProvider>
      <WalletAuthProvider>
        <WebSocketProvider>
          <ConnectionStatusBanner />
          <Outlet />
        </WebSocketProvider>
        <HiddenLogViewer />
      </WalletAuthProvider>
    </NoticeProvider>
  </TolgeeProvider>
)

export default ProductApplicationShell
