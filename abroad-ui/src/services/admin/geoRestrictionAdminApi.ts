import type { OpsGeoRestriction, OpsUpdateGeoRestrictionInput } from './geoRestrictionTypes'
import type { OpsMutationDetails } from './opsMutationTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'

const GEO_RESTRICTION_PATH = '/ops/configuration/geo-restriction'

export const getGeoRestriction = async (): Promise<OpsGeoRestriction> => {
  const result = await adminRequest<OpsGeoRestriction>(GEO_RESTRICTION_PATH, { method: 'GET' })

  return unwrapAdminResult(result)
}

export const updateGeoRestriction = async (
  payload: OpsUpdateGeoRestrictionInput,
  mutation: OpsMutationDetails,
): Promise<OpsGeoRestriction> => {
  const result = await adminRequest<OpsGeoRestriction>(GEO_RESTRICTION_PATH, {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
    mutation,
  })

  return unwrapAdminResult(result)
}
