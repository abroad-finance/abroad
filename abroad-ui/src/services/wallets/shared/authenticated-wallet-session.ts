import { sessionStore } from '../../auth/sessionStore'

type AuthenticatedWalletSession = Readonly<{
  address: string
  chainId: string
  walletId: string
}>

type CommitAuthenticatedWalletParams = Readonly<{
  authenticate: () => Promise<unknown>
  onCommitted: () => void
  session: AuthenticatedWalletSession
}>

/**
 * Makes authentication the commit boundary for a connected wallet.
 * Consumers must never observe an address or persisted session before the
 * challenge has been verified successfully.
 */
export const commitAuthenticatedWallet = async ({ authenticate, onCommitted, session }: CommitAuthenticatedWalletParams): Promise<void> => {
  await authenticate()
  sessionStore.set(session)
  onCommitted()
}
