import type { PropertyOptions } from 'adminjs'

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

const propertyConfigs: PropertyConfig[] = [
  { key: 'fecha', label: 'Fecha', position: 10 },
  { key: 'tipoDocumento', label: 'Tipo de Documento', position: 20 },
  { key: 'numeroDocumento', label: 'Numero de documento', position: 25 },
  { key: 'nombreRazonSocial', label: 'Nombre o Razón Social', position: 30 },
  { key: 'direccion', label: 'Dirección', position: 40, visibility: { filter: false } },
  { key: 'telefono', label: 'Teléfono', position: 50, visibility: { filter: false } },
  { key: 'email', label: 'Email', position: 60 },
  { key: 'pais', label: 'País', position: 70 },
  { key: 'departamento', label: 'Departamento', position: 80 },
  { key: 'municipio', label: 'Municipio', position: 90 },
  { key: 'montoCop', label: 'Monto en COP', position: 100, visibility: { filter: false } },
  { key: 'montoUsdc', label: 'Monto en USDC', position: 110, visibility: { filter: false } },
  { key: 'trm', label: 'TRM', position: 120, visibility: { filter: false } },
  { key: 'hashTransaccion', label: 'Hash de la transacción', position: 130 },
  { key: 'tipoOperacion', label: 'Compra o Venta', position: 140 },
]

function buildStringProperty(config: PropertyConfig): PropertyOptions {
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

export const transactionQuoteProperties: Record<string, PropertyOptions> = propertyConfigs.reduce(
  (acc, config) => ({
    ...acc,
    [config.key]: buildStringProperty(config),
  }),
  {
    id: {
      isId: true,
      isVisible: { edit: false, filter: true, list: true, show: true },
    } satisfies PropertyOptions,
  } as Record<string, PropertyOptions>,
)
