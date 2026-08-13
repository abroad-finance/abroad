export type OpsGeoRestriction = {
  enabled: boolean
  restrictedCountries: string[]
  updatedAt: string
  version: number
}

export type OpsUpdateGeoRestrictionInput = {
  enabled: boolean
}
