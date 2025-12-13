import type { PropertyOptions } from 'adminjs'

import propertyConfigsJson from './transactionQuoteProperties.config.json'

type LabeledPropertyOptions = PropertyOptions & { label?: string }
interface PropertyConfig {
  key: string
  label: string
  position: number
  visibility?: Partial<VisibilityPreset>
}

type VisibilityPreset = { edit: false, filter: boolean, list: boolean, show: boolean }

const baseVisibility: VisibilityPreset = {
  edit: false,
  filter: true,
  list: true,
  show: true,
}

const propertyConfigs: PropertyConfig[] = propertyConfigsJson

const idProperty: PropertyOptions = {
  isId: true,
  isVisible: baseVisibility,
}

const buildStringProperty = (config: PropertyConfig): PropertyOptions => {
  const visibility = { ...baseVisibility, ...(config.visibility ?? {}) }
  const property: LabeledPropertyOptions = {
    isSortable: false,
    isVisible: visibility,
    label: config.label,
    position: config.position,
    type: 'string',
  }
  return property
}

const buildTransactionQuoteProperties = (): Record<string, PropertyOptions> => {
  const properties: Record<string, PropertyOptions> = { id: idProperty }
  for (const config of propertyConfigs) {
    properties[config.key] = buildStringProperty(config)
  }
  return properties
}

export const transactionQuoteProperties = buildTransactionQuoteProperties()
