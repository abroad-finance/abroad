import {
  describe, expect, it, vi,
} from 'vitest'

import {
  hasCompletedOnboarding,
  ONBOARDING_COMPLETION_KEY,
  rememberOnboardingCompletion,
} from '../features/swap/model/onboardingPreference'

describe('onboarding preference', () => {
  it('restores only the versioned completed value', () => {
    expect(hasCompletedOnboarding({ getItem: () => 'completed' })).toBe(true)
    expect(hasCompletedOnboarding({ getItem: () => 'true' })).toBe(false)
    expect(hasCompletedOnboarding({ getItem: () => null })).toBe(false)
  })

  it('persists completion without granting anything when storage is unavailable', () => {
    const setItem = vi.fn()

    expect(rememberOnboardingCompletion({ setItem })).toBe(true)
    expect(setItem).toHaveBeenCalledWith(ONBOARDING_COMPLETION_KEY, 'completed')
    expect(rememberOnboardingCompletion(null)).toBe(false)
    expect(rememberOnboardingCompletion({
      setItem: () => {
        throw new DOMException('Storage disabled')
      },
    })).toBe(false)
  })

  it('fails closed to showing onboarding when reads are blocked', () => {
    expect(hasCompletedOnboarding({
      getItem: () => {
        throw new DOMException('Storage disabled')
      },
    })).toBe(false)
  })
})
