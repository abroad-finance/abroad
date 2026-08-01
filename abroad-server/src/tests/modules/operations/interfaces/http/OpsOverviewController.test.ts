import 'reflect-metadata'

import { OpsOverviewResponse, OpsOverviewService } from '../../../../../modules/operations/application/OpsOverviewService'
import { OpsOverviewController } from '../../../../../modules/operations/interfaces/http/OpsOverviewController'

type OverviewServiceMock = Pick<OpsOverviewService, 'getOverview'>

const buildController = (service: OverviewServiceMock): OpsOverviewController => (
  new OpsOverviewController(service as unknown as OpsOverviewService)
)

describe('OpsOverviewController', () => {
  it('defaults to the seven-day range', async () => {
    const response = { generatedAt: new Date('2026-08-01T00:00:00.000Z') } as OpsOverviewResponse
    const service: jest.Mocked<OverviewServiceMock> = {
      getOverview: jest.fn(async (range) => {
        void range
        return response
      }),
    }
    const controller = buildController(service)

    const result = await controller.getOverview()

    expect(service.getOverview).toHaveBeenCalledWith('7d')
    expect(result).toBe(response)
  })

  it('forwards the requested range', async () => {
    const response = { generatedAt: new Date('2026-08-01T00:00:00.000Z') } as OpsOverviewResponse
    const service: jest.Mocked<OverviewServiceMock> = {
      getOverview: jest.fn(async (range) => {
        void range
        return response
      }),
    }
    const controller = buildController(service)

    await controller.getOverview('30d')

    expect(service.getOverview).toHaveBeenCalledWith('30d')
  })
})
