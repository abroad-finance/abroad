import type { ReactNode } from 'react'

import type { OpsMutationContextValue } from '../pages/Ops/shared/opsMutationContext'

import { OpsMutationContext } from '../pages/Ops/shared/opsMutationContext'
import { testOpsMutationDetails } from './opsMutationTestFixtures'

const immediateContext: OpsMutationContextValue = {
  requestMutation: request => request.execute(request.expectedVersion === undefined
    ? testOpsMutationDetails
    : { ...testOpsMutationDetails, expectedVersion: request.expectedVersion }),
}

export const ImmediateOpsMutationProvider = ({ children }: { children: ReactNode }) => (
  <OpsMutationContext.Provider value={immediateContext}>
    {children}
  </OpsMutationContext.Provider>
)
