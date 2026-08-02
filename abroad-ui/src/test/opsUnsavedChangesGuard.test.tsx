import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, useLocation } from 'react-router-dom'
import {
  describe,
  expect,
  it,
} from 'vitest'

import { OpsUnsavedChangesGuard } from '../pages/Ops/shared/OpsUnsavedChangesGuard'

const LocationProbe = () => {
  const location = useLocation()
  return <output aria-label="Current route">{location.pathname}</output>
}

describe('OpsUnsavedChangesGuard', () => {
  it('uses an accessible decision before leaving through application navigation', async () => {
    render(
      <MemoryRouter initialEntries={['/editor']}>
        <OpsUnsavedChangesGuard active />
        <Link to="/ops/configuration/history">Configuration history</Link>
        <LocationProbe />
      </MemoryRouter>,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('link', { name: 'Configuration history' }))

    expect(screen.getByRole('dialog', { name: 'Leave for Configuration history?' })).toBeInTheDocument()
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/editor')

    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/editor')

    await user.click(screen.getByRole('link', { name: 'Configuration history' }))
    await user.click(screen.getByRole('button', { name: 'Discard and leave' }))
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/ops/configuration/history')
  })

  it('registers the platform refresh and close protection only while active', () => {
    const { rerender } = render(
      <MemoryRouter>
        <OpsUnsavedChangesGuard active />
      </MemoryRouter>,
    )
    const guardedEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(guardedEvent)
    expect(guardedEvent.defaultPrevented).toBe(true)

    rerender(
      <MemoryRouter>
        <OpsUnsavedChangesGuard active={false} />
      </MemoryRouter>,
    )
    const inactiveEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(inactiveEvent)
    expect(inactiveEvent.defaultPrevented).toBe(false)
  })
})
