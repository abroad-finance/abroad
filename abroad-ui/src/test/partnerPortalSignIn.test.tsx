import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import PartnerPortalSignIn from '../pages/PartnerPortal/PartnerPortalSignIn'
import {
  clearPartnerPortalSession,
  getPartnerPortalSession,
} from '../services/partnerPortal/partnerPortalSessionStore'

const mocked = vi.hoisted(() => ({
  createPartnerPortalSession: vi.fn(),
}))

vi.mock('../services/partnerPortal/partnerPortalApi', () => ({
  createPartnerPortalSession: mocked.createPartnerPortalSession,
}))

afterEach(() => {
  clearPartnerPortalSession()
  vi.clearAllMocks()
})

describe('PartnerPortalSignIn', () => {
  it('stores only the short-lived portal session and clears the key input', async () => {
    mocked.createPartnerPortalSession.mockResolvedValue({
      accessToken: 'scoped-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      partnerName: 'Decaf',
    })
    render(<PartnerPortalSignIn />)
    const user = userEvent.setup()
    const keyInput = screen.getByLabelText('Partner API key')

    await user.type(keyInput, 'secret-partner-key')
    await user.click(screen.getByRole('button', { name: 'Open transactions' }))

    await waitFor(() => expect(getPartnerPortalSession()?.accessToken).toBe('scoped-token'))
    expect(mocked.createPartnerPortalSession).toHaveBeenCalledWith('secret-partner-key')
    expect(keyInput).toHaveValue('')
    expect(window.sessionStorage.getItem('abroad.partnerPortal.session.v1')).not.toContain('secret-partner-key')
  })

  it('shows an authentication failure without persisting a session', async () => {
    mocked.createPartnerPortalSession.mockRejectedValue(new Error('Invalid partner key'))
    render(<PartnerPortalSignIn />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Partner API key'), 'wrong-key')
    await user.click(screen.getByRole('button', { name: 'Open transactions' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid partner key')
    expect(getPartnerPortalSession()).toBeNull()
  })
})
