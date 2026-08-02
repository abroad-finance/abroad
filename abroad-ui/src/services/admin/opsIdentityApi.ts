import type { FirebaseApp, FirebaseOptions } from 'firebase/app'
import type { Auth } from 'firebase/auth'

import { getApps, initializeApp } from 'firebase/app'
import {
  browserSessionPersistence,
  getAuth,
  GoogleAuthProvider,
  reauthenticateWithPopup,
  setPersistence,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import { z } from 'zod'

import type { OpsSession } from './opsAuthStore'
import type { OpsMutationAction, OpsMutationPolicy } from './opsMutationTypes'

import {
  getOpsApiKey,
  setOpsAuthStatus,
  setOpsSession,
} from './opsAuthStore'
import { opsMutationActions } from './opsMutationTypes'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://api.abroad.finance'
const OPS_FIREBASE_APP_NAME = 'abroad-ops'

const identityConfigSchema = z.object({
  allowedEmailDomain: z.string().min(1),
  firebaseConfigPath: z.string().startsWith('/'),
  mutationPolicies: z.array(z.object({
    action: z.enum(opsMutationActions),
    approvalClass: z.enum([
      'CONFIRMATION',
      'DIRECT',
      'SECOND_APPROVER',
      'STEP_UP',
    ]),
    confirmation: z.string().min(1),
    expectedVersion: z.boolean(),
    impact: z.string().min(1),
    permission: z.string().min(1),
    stepUpRequired: z.boolean(),
  })).default([]),
  provider: z.literal('google.com'),
  stepUpMaxAgeSeconds: z.number().int().positive(),
})

const firebaseOptionsSchema = z.object({
  apiKey: z.string().min(1),
  appId: z.string().min(1),
  authDomain: z.string().min(1),
  messagingSenderId: z.string().min(1).optional(),
  projectId: z.string().min(1),
  storageBucket: z.string().min(1).optional(),
}).passthrough()

const opsSessionSchema = z.object({
  authenticatedAt: z.string().datetime().nullable(),
  bootstrapRequired: z.boolean(),
  displayName: z.string().min(1),
  email: z.string().email().nullable(),
  kind: z.enum(['ops_legacy', 'ops_user']),
  permissions: z.array(z.string()),
  role: z.string().nullable(),
  sessionVersion: z.number().int().nullable(),
  stepUpExpiresAt: z.string().datetime().nullable(),
  userId: z.string().nullable(),
})

export type OpsIdentityConfig = z.infer<typeof identityConfigSchema>

let authPromise: null | Promise<Auth> = null
let identityConfigPromise: null | Promise<OpsIdentityConfig> = null

const readReason = async (response: Response): Promise<string> => {
  try {
    const body = await response.json() as { reason?: unknown }
    if (typeof body.reason === 'string' && body.reason.trim()) {
      return body.reason
    }
  }
  catch {
    // Preserve the status-based fallback when the response is not JSON.
  }
  return `Ops authentication failed with status ${response.status}`
}

const requestSession = async (
  path: 'bootstrap' | 'me' | 'session',
  idToken: string,
  legacyApiKey?: string,
): Promise<OpsSession> => {
  const headers = new Headers({ Authorization: `Bearer ${idToken}` })
  if (legacyApiKey) {
    headers.set('X-OPS-API-KEY', legacyApiKey)
  }
  const response = await fetch(`${API_BASE_URL}/ops/auth/${path}`, {
    cache: 'no-store',
    headers,
    method: path === 'me' ? 'GET' : 'POST',
  })
  if (!response.ok) {
    throw new Error(await readReason(response))
  }
  return opsSessionSchema.parse(await response.json())
}

const requestIdentityConfig = async (): Promise<OpsIdentityConfig> => {
  const response = await fetch(`${API_BASE_URL}/ops/auth/config`, {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(await readReason(response))
  }
  return identityConfigSchema.parse(await response.json())
}

const getIdentityConfig = (): Promise<OpsIdentityConfig> => {
  identityConfigPromise ??= requestIdentityConfig().catch((error: unknown) => {
    identityConfigPromise = null
    throw error
  })
  return identityConfigPromise
}

export const getOpsMutationPolicy = async (
  action: OpsMutationAction,
): Promise<OpsMutationPolicy> => {
  const config = await getIdentityConfig()
  const policy = config.mutationPolicies.find(candidate => candidate.action === action)
  if (!policy) {
    throw new Error(`The server did not publish a mutation policy for ${action}`)
  }
  return policy
}

const getOrCreateFirebaseApp = (options: FirebaseOptions): FirebaseApp => {
  const existing = getApps().find(app => app.name === OPS_FIREBASE_APP_NAME)
  return existing ?? initializeApp(options, OPS_FIREBASE_APP_NAME)
}

const initializeOpsAuth = async (): Promise<Auth> => {
  const identityConfig = await getIdentityConfig()
  const firebaseConfigResponse = await fetch(identityConfig.firebaseConfigPath, {
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (!firebaseConfigResponse.ok) {
    throw new Error('Organization sign-in configuration is unavailable')
  }
  const options = firebaseOptionsSchema.parse(await firebaseConfigResponse.json())
  const auth = getAuth(getOrCreateFirebaseApp(options))
  await setPersistence(auth, browserSessionPersistence)
  return auth
}

const getOpsAuth = (): Promise<Auth> => {
  authPromise ??= initializeOpsAuth().catch((error: unknown) => {
    // Identity-provider recovery must remain possible after a transient config,
    // SDK, or network failure. Caching a rejected promise would otherwise make
    // the emergency legacy path await the same permanent rejection forever.
    authPromise = null
    throw error
  })
  return authPromise
}

const getGoogleProvider = (): GoogleAuthProvider => {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({
    hd: 'abroad.finance',
    prompt: 'select_account',
  })
  return provider
}

const handleAuthenticationFailure = (error: unknown): never => {
  const message = error instanceof Error ? error.message : 'Organization sign-in failed'
  setOpsAuthStatus('error', message)
  throw error instanceof Error ? error : new Error(message)
}

export const restoreOpsSession = async (): Promise<null | OpsSession> => {
  setOpsAuthStatus('initializing')
  try {
    const auth = await getOpsAuth()
    await auth.authStateReady()
    if (!auth.currentUser) {
      setOpsSession(null)
      return null
    }
    const session = await requestSession('me', await auth.currentUser.getIdToken())
    setOpsSession(session)
    return session
  }
  catch (error) {
    return handleAuthenticationFailure(error)
  }
}

export const signInToOps = async (): Promise<OpsSession> => {
  setOpsAuthStatus('authenticating')
  try {
    const auth = await getOpsAuth()
    const credential = await signInWithPopup(auth, getGoogleProvider())
    const session = await requestSession('session', await credential.user.getIdToken(true))
    setOpsSession(session)
    return session
  }
  catch (error) {
    return handleAuthenticationFailure(error)
  }
}

export const bootstrapOpsAdministrator = async (legacyApiKey: string): Promise<OpsSession> => {
  setOpsAuthStatus('authenticating')
  try {
    const auth = await getOpsAuth()
    if (!auth.currentUser) {
      throw new Error('Sign in with an Abroad account before bootstrap')
    }
    const session = await requestSession(
      'bootstrap',
      await auth.currentUser.getIdToken(true),
      legacyApiKey.trim(),
    )
    setOpsSession(session)
    return session
  }
  catch (error) {
    return handleAuthenticationFailure(error)
  }
}

export const stepUpOpsSession = async (): Promise<OpsSession> => {
  setOpsAuthStatus('authenticating')
  try {
    const auth = await getOpsAuth()
    if (!auth.currentUser) {
      throw new Error('Sign in before reauthenticating')
    }
    const credential = await reauthenticateWithPopup(auth.currentUser, getGoogleProvider())
    const session = await requestSession('me', await credential.user.getIdToken(true))
    setOpsSession(session)
    return session
  }
  catch (error) {
    return handleAuthenticationFailure(error)
  }
}

export const signOutFromOps = async (): Promise<void> => {
  try {
    const auth = await getOpsAuth()
    await signOut(auth)
  }
  finally {
    setOpsSession(null)
  }
}

export const getOpsCredentialHeaders = async (): Promise<Headers> => {
  if (authPromise) {
    const auth = await authPromise
    if (auth.currentUser) {
      return new Headers({ Authorization: `Bearer ${await auth.currentUser.getIdToken()}` })
    }
  }

  const legacyApiKey = getOpsApiKey()
  if (legacyApiKey) {
    return new Headers({ 'X-OPS-API-KEY': legacyApiKey })
  }
  throw new Error('Sign in with your Abroad account to access Ops')
}
