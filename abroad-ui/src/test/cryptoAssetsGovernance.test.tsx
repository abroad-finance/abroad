import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import CryptoAssets from '../pages/Ops/CryptoAssets'
import { setOpsSession } from '../services/admin/opsAuthStore'
import { ImmediateOpsMutationProvider } from './opsMutationTestUtils'

const flowMocked = vi.hoisted(() => ({
  listCryptoAssets: vi.fn(),
  updateCryptoAsset: vi.fn(),
}))
const releaseMocked = vi.hoisted(() => ({
  createOpsConfigurationRelease: vi.fn(),
}))

vi.mock('../services/admin/flowAdminApi', () => flowMocked)
vi.mock('../services/admin/configurationReleaseAdminApi', () => releaseMocked)

const LocationProbe = () => {
  const location = useLocation()
  return <output aria-label="Current route">{`${location.pathname}${location.search}`}</output>
}

afterEach(() => {
  setOpsSession(null)
  vi.clearAllMocks()
})

describe('CryptoAssets configuration governance', () => {
  it('turns missing coverage into a URL-backed action and creates a review draft', async () => {
    setOpsSession({
      authenticatedAt: '2026-08-02T18:00:00.000Z',
      bootstrapRequired: false,
      displayName: 'Configuration Owner',
      email: 'owner@abroad.finance',
      kind: 'ops_user',
      permissions: ['configuration:manage', 'configuration:read'],
      role: 'ADMINISTRATOR',
      sessionVersion: 1,
      stepUpExpiresAt: null,
      userId: 'ops-owner',
    })
    flowMocked.listCryptoAssets.mockResolvedValue({
      assets: [{
        blockchain: 'STELLAR',
        cryptoCurrency: 'USDC',
        decimals: null,
        enabled: false,
        mintAddress: null,
        status: 'MISSING',
        updatedAt: null,
        version: 1,
      }, {
        blockchain: 'SOLANA',
        cryptoCurrency: 'USDC',
        decimals: 6,
        enabled: true,
        mintAddress: 'solana-mint',
        status: 'CONFIGURED',
        updatedAt: '2026-08-01T12:00:00.000Z',
        version: 2,
      }],
      summary: {
        configured: 1, enabled: 1, missing: 1, total: 2,
      },
    })
    releaseMocked.createOpsConfigurationRelease.mockResolvedValue({
      id: 'release-asset-1',
      status: 'DRAFT',
      title: 'Update USDC on Stellar coverage',
    })

    render(
      <MemoryRouter initialEntries={['/ops/configuration/assets']}>
        <ImmediateOpsMutationProvider>
          <CryptoAssets />
          <LocationProbe />
        </ImmediateOpsMutationProvider>
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Missing coverage.*Open missing combinations/ }))
    expect(screen.getByLabelText('Current route')).toHaveTextContent('status=missing')

    await user.type(screen.getByLabelText('Mint or issuer'), 'GA-NEW-ISSUER')
    await user.click(screen.getByRole('button', { name: 'Create review draft' }))

    expect(releaseMocked.createOpsConfigurationRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          kind: 'CRYPTO_ASSET',
          value: expect.objectContaining({
            blockchain: 'STELLAR',
            cryptoCurrency: 'USDC',
            mintAddress: 'GA-NEW-ISSUER',
          }),
        },
      }),
      expect.objectContaining({ reason: 'Focused automated test operation' }),
    )
    expect(flowMocked.updateCryptoAsset).not.toHaveBeenCalled()
    expect(await screen.findByRole('link', { name: 'Update USDC on Stellar coverage' })).toHaveAttribute(
      'href',
      '/ops/configuration/history?release=release-asset-1',
    )
  })
})
