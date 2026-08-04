export const ONBOARDING_COMPLETION_KEY = 'abroad.consumer.onboarding.v1'

const browserStorage = (): null | Storage => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  }
  catch {
    return null
  }
}

export const hasCompletedOnboarding = (
  storage: null | Pick<Storage, 'getItem'> = browserStorage(),
): boolean => {
  if (!storage) return false
  try {
    return storage.getItem(ONBOARDING_COMPLETION_KEY) === 'completed'
  }
  catch {
    // Storage can be disabled by browser privacy settings. The safe fallback is
    // to show onboarding again; this preference never grants authentication.
    return false
  }
}

export const rememberOnboardingCompletion = (
  storage: null | Pick<Storage, 'setItem'> = browserStorage(),
): boolean => {
  if (!storage) return false
  try {
    storage.setItem(ONBOARDING_COMPLETION_KEY, 'completed')
    return true
  }
  catch {
    // Completion is a non-sensitive convenience preference. The current
    // session may continue even when persistence is unavailable.
    return false
  }
}
