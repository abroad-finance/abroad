import type { Prisma } from '@prisma/client'

export type OpsIncidentAffectedResource = {
  id: string
  label: string
  path: string
  type: 'BRIDGE_BATCH' | 'BRIDGE_LEG' | 'FLOW' | 'PARTNER' | 'TRANSACTION'
}

export type OpsIncidentContext = {
  affected: OpsIncidentAffectedResource[]
  dimensions: OpsIncidentDimension[]
  filters: OpsIncidentFilterLink[]
}

type OpsIncidentDimension = {
  label: string
  value: string
}

type OpsIncidentFilterLink = {
  label: string
  path: string
}

const EMPTY_CONTEXT: OpsIncidentContext = {
  affected: [],
  dimensions: [],
  filters: [],
}

const isRecord = (value: Prisma.JsonValue): value is Prisma.JsonObject => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const readBoundedString = (value: Prisma.JsonValue | undefined, maximum: number): null | string => (
  typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null
)

export const parseIncidentContext = (value: null | Prisma.JsonValue): OpsIncidentContext => {
  if (!value || !isRecord(value)) return EMPTY_CONTEXT
  const affected = Array.isArray(value.affected)
    ? value.affected.slice(0, 25).flatMap((entry): OpsIncidentAffectedResource[] => {
        if (!isRecord(entry)) return []
        const id = readBoundedString(entry.id, 128)
        const label = readBoundedString(entry.label, 160)
        const path = readBoundedString(entry.path, 500)
        const type = readBoundedString(entry.type, 30)
        if (
          !id
          || !label
          || !path?.startsWith('/ops/')
          || !type
          || !['BRIDGE_BATCH', 'BRIDGE_LEG', 'FLOW', 'PARTNER', 'TRANSACTION'].includes(type)
        ) return []
        return [{ id, label, path, type: type as OpsIncidentAffectedResource['type'] }]
      })
    : []
  const dimensions = Array.isArray(value.dimensions)
    ? value.dimensions.slice(0, 12).flatMap((entry): OpsIncidentDimension[] => {
        if (!isRecord(entry)) return []
        const label = readBoundedString(entry.label, 80)
        const dimensionValue = readBoundedString(entry.value, 160)
        return label && dimensionValue ? [{ label, value: dimensionValue }] : []
      })
    : []
  const filters = Array.isArray(value.filters)
    ? value.filters.slice(0, 12).flatMap((entry): OpsIncidentFilterLink[] => {
        if (!isRecord(entry)) return []
        const label = readBoundedString(entry.label, 100)
        const path = readBoundedString(entry.path, 500)
        return label && path?.startsWith('/ops/') ? [{ label, path }] : []
      })
    : []
  return { affected, dimensions, filters }
}

export const serializeIncidentContext = (context: OpsIncidentContext): Prisma.InputJsonObject => ({
  affected: context.affected.map(resource => ({ ...resource })),
  dimensions: context.dimensions.map(dimension => ({ ...dimension })),
  filters: context.filters.map(filter => ({ ...filter })),
})
