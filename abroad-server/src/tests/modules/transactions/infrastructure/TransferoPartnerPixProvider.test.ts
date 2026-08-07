import 'reflect-metadata'

import { TransferoPartnerPixProvider } from '../../../../modules/transactions/infrastructure/TransferoPartnerPixProvider'
import { TransferoUltraClient, TransferoUltraError } from '../../../../modules/transfero/infrastructure/TransferoUltraClient'

const withdrawalId = '22222222-2222-4222-8222-222222222222'

const buildHarness = () => {
  const get = jest.fn<Promise<unknown>, [string]>()
  const getPdf = jest.fn<Promise<{ contentType: 'application/pdf', data: Buffer }>, [string, unknown?]>()
  const ultraClient = { get, getPdf } as unknown as TransferoUltraClient
  return { get, getPdf, provider: new TransferoPartnerPixProvider(ultraClient) }
}

const ultraError = (status: number) => new TransferoUltraError({
  code: 'validation',
  message: 'provider response detail',
  status,
})

describe('TransferoPartnerPixProvider', () => {
  describe('fetchWithdrawalReceipt', () => {
    it('returns the pdf bytes and encodes the withdrawal id into the path', async () => {
      const harness = buildHarness()
      harness.getPdf.mockResolvedValueOnce({
        contentType: 'application/pdf',
        data: Buffer.from('%PDF-1.7'),
      })

      const result = await harness.provider.fetchWithdrawalReceipt({
        language: 'pt-BR',
        withdrawalId,
      })

      expect(harness.getPdf).toHaveBeenCalledWith(
        `/api/v1/pix/withdrawals/${withdrawalId}/receipt`,
        { lang: 'pt-BR' },
      )
      expect(result).toEqual({
        contentType: 'application/pdf',
        data: Buffer.from('%PDF-1.7'),
        success: true,
      })
    })

    it.each([404, 409])('reports %s as unavailable rather than an error', async (status) => {
      const harness = buildHarness()
      harness.getPdf.mockRejectedValueOnce(ultraError(status))

      await expect(harness.provider.fetchWithdrawalReceipt({
        language: 'en',
        withdrawalId,
      })).resolves.toEqual({ reason: 'unavailable', success: false })
    })

    it.each([
      ['a non-404/409 provider status', ultraError(500)],
      ['a non-provider failure', new Error('secret provider detail')],
    ])('reports %s as a provider error', async (_label, thrown) => {
      const harness = buildHarness()
      harness.getPdf.mockRejectedValueOnce(thrown)

      await expect(harness.provider.fetchWithdrawalReceipt({
        language: 'en',
        withdrawalId,
      })).resolves.toEqual({ reason: 'provider_error', success: false })
    })
  })

  describe('readWithdrawalDetail', () => {
    it('returns only the fields the reconciler needs', async () => {
      const harness = buildHarness()
      harness.get.mockResolvedValueOnce({
        endToEndId: 'E2E-1',
        id: withdrawalId,
        // Ultra sends more than this; the port must not widen to carry it.
        netAmount: 10,
        status: 'SETTLED',
      })

      const result = await harness.provider.readWithdrawalDetail(withdrawalId)

      expect(harness.get).toHaveBeenCalledWith(`/api/v1/pix/withdrawals/${withdrawalId}`)
      expect(result).toEqual({
        detail: { endToEndId: 'E2E-1', id: withdrawalId, status: 'SETTLED' },
        success: true,
      })
    })

    it('distinguishes a 404 from any other provider failure', async () => {
      const harness = buildHarness()

      harness.get.mockRejectedValueOnce(ultraError(404))
      await expect(harness.provider.readWithdrawalDetail(withdrawalId))
        .resolves.toEqual({ reason: 'not_found', success: false })

      harness.get.mockRejectedValueOnce(ultraError(503))
      await expect(harness.provider.readWithdrawalDetail(withdrawalId))
        .resolves.toEqual({ reason: 'provider_unavailable', success: false })

      harness.get.mockRejectedValueOnce(new Error('boom'))
      await expect(harness.provider.readWithdrawalDetail(withdrawalId))
        .resolves.toEqual({ reason: 'provider_unavailable', success: false })
    })

    it('rejects a payload that fails the schema', async () => {
      const harness = buildHarness()
      harness.get.mockResolvedValueOnce({ id: 'not-a-uuid', status: 'SETTLED' })

      await expect(harness.provider.readWithdrawalDetail(withdrawalId))
        .resolves.toEqual({ reason: 'invalid_response', success: false })
    })

    it('rejects a payload describing a different withdrawal', async () => {
      const harness = buildHarness()
      harness.get.mockResolvedValueOnce({
        endToEndId: 'E2E-1',
        id: '33333333-3333-4333-8333-333333333333',
        status: 'SETTLED',
      })

      await expect(harness.provider.readWithdrawalDetail(withdrawalId))
        .resolves.toEqual({ reason: 'invalid_response', success: false })
    })

    it('passes a null end-to-end id through instead of failing', async () => {
      const harness = buildHarness()
      harness.get.mockResolvedValueOnce({
        endToEndId: null,
        id: withdrawalId,
        status: 'PROCESSING',
      })

      await expect(harness.provider.readWithdrawalDetail(withdrawalId))
        .resolves.toEqual({
          detail: { endToEndId: null, id: withdrawalId, status: 'PROCESSING' },
          success: true,
        })
    })
  })
})
