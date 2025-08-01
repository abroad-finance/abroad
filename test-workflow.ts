import { KYCTier } from '@prisma/client'

import { nextWorkflowId } from './src/constants/workflowRules'

// Test case: CO, amount < 150, existing tier NONE
console.log('Testing CO with amount 100 and KYCTier.NONE:')
const result = nextWorkflowId('CO', 100, KYCTier.NONE)
console.log('Result:', result)
console.log('Expected: c0a1b7a51efa867e')

// Debug the intermediate values
const tierRule = {
  BR: (amt: number) => (amt <= 10_000 ? KYCTier.BASIC : KYCTier.ENHANCED),
  CO: (amt: number) =>
    amt <= 150
      ? KYCTier.BASIC
      : amt <= 10_000
        ? KYCTier.STANDARD
        : KYCTier.ENHANCED,
}

const workflowByTier = {
  BR: {
    [KYCTier.BASIC]: '39ab7843d047521e',
    [KYCTier.ENHANCED]: 'be9d1560c0b88e24',
    [KYCTier.NONE]: null,
    [KYCTier.STANDARD]: null,
  },
  CO: {
    [KYCTier.BASIC]: 'c0a1b7a51efa867e',
    [KYCTier.ENHANCED]: 'f39d58daf6752bea',
    [KYCTier.NONE]: null,
    [KYCTier.STANDARD]: '363fcc81f21f8f1f',
  },
}

console.log('\nDebug values:')
console.log('KYCTier.NONE:', KYCTier.NONE)
console.log('KYCTier.BASIC:', KYCTier.BASIC)
const requiredTier = tierRule['CO'](100)
console.log('Required tier for CO, 100:', requiredTier)
console.log('Existing tier >= required tier:', KYCTier.NONE >= requiredTier)
console.log('Workflow for required tier:', workflowByTier['CO'][requiredTier])
