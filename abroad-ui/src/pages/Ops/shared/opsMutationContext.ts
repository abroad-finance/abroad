import { createContext, useContext } from 'react'

import type { OpsMutationAction, OpsMutationDetails } from '../../../services/admin/opsMutationTypes'

export type OpsMutationContextValue = {
  requestMutation: <TResult>(request: OpsMutationRequest<TResult>) => Promise<TResult>
}

export type OpsMutationRequest<TResult> = {
  action: OpsMutationAction
  execute: (details: OpsMutationDetails) => Promise<TResult>
  expectedVersion?: number
  resourceLabel?: string
  title: string
}

export const OpsMutationContext = createContext<null | OpsMutationContextValue>(null)

export class OpsMutationCancelledError extends Error {
  public constructor() {
    super('Operation cancelled')
    this.name = 'OpsMutationCancelledError'
  }
}

export const isOpsMutationCancelledError = (error: unknown): boolean => (
  error instanceof OpsMutationCancelledError
)

export const useOpsMutation = (): OpsMutationContextValue => {
  const context = useContext(OpsMutationContext)
  if (!context) {
    throw new Error('useOpsMutation must be used within OpsMutationProvider')
  }
  return context
}
