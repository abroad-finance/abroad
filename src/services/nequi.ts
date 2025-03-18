// src/services/nequi.ts
import { TargetCurrency } from '@prisma/client'
import axios, { AxiosResponse } from 'axios'
import { inject } from 'inversify'

import { IPaymentService } from '../interfaces/IPaymentService'
import { ISecretManager } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

export type ResponseNequiDispersion = {
  ResponseMessage: {
    ResponseBody: {
      any: unknown
    }
    ResponseHeader: {
      Channel: string
      ClientID: string
      Destination: {
        ServiceName: string
        ServiceOperation: string
        ServiceRegion: string
        ServiceVersion: string
      }
      MessageID: string
      ResponseDate: string
      Status: {
        StatusCode: string
        StatusDesc: string
      }
    }
  }
}

export class NequiPaymentService implements IPaymentService {
  public readonly banks = []
  public readonly currency = TargetCurrency.COP
  public readonly fixedFee = 1354

  public readonly MAX_TOTAL_AMOUNT_PER_DAY: number = 10_000_000
  public readonly MAX_USER_AMOUNT_PER_DAY: number = 10_000_000
  public readonly MAX_USER_AMOUNT_PER_TRANSACTION: number = 500_000
  public readonly MAX_USER_TRANSACTIONS_PER_DAY: number = 15

  public readonly percentageFee = 0.0

  private token: null | string = null
  private tokenExpiration: null | number = null

  public constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) { }

  onboardUser(): Promise<{ message?: string, success: boolean }> {
    throw new Error('Method not implemented.')
  }

  public sendPayment: IPaymentService['sendPayment'] = async ({
    account,
    id,
    value,
  }) => {
    console.log('[NequiPaymentService]: Sending payment to Nequi:', {
      account,
      id,
      value,
    })

    const DISPERSION_CODE_NEQUI = await this.secretManager.getSecret(
      'DISPERSION_CODE_NEQUI',
    )

    const messageId = Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 10),
    ).join('')
    const trackingId
      = 'DAN'
        + Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('')

    const body = {
      RequestMessage: {
        RequestBody: {
          any: {
            disperseFundsRQ: {
              code: DISPERSION_CODE_NEQUI,
              phoneNumber: account,
              reference1: id,
              reference2: messageId,
              reference3: messageId,
              trackingID: trackingId,
              value,
            },
          },
        },
        RequestHeader: {
          Channel: 'GLK06-C001',
          ClientID: messageId,
          Destination: {
            ServiceName: 'DispersionService',
            ServiceOperation: 'disperseFunds',
            ServiceRegion: 'C001',
            ServiceVersion: '1.0.0',
          },
          MessageID: messageId,
          RequestDate: new Date().toJSON(),
        },
      },
    }

    const response = await this.makeRequest<ResponseNequiDispersion>(
      '/dispersions/v2/-services-dispersionservice-dispersefunds',
      body,
    )
    console.log(
      '[NequiPaymentService]: ',
      'response ',
      response.ResponseMessage.ResponseHeader.Status,
    )

    return {
      success:
        response.ResponseMessage.ResponseHeader.Status.StatusDesc === 'SUCCESS',
      transactionId: response.ResponseMessage.ResponseHeader.MessageID,
    }
  }

  public verifyAccount: IPaymentService['verifyAccount'] = async () => {
    // This method cannot be implemented for Nequi
    return Promise.resolve(true)
  }

  private async getAuthToken(): Promise<string> {
    const ACCESS_KEY_NEQUI
      = await this.secretManager.getSecret('ACCESS_KEY_NEQUI')
    const SECRET_KEY_NEQUI
      = await this.secretManager.getSecret('SECRET_KEY_NEQUI')
    const URL_NEQUI_AUTH = await this.secretManager.getSecret('URL_NEQUI_AUTH')

    if (
      this.token
      && this.tokenExpiration
      && Date.now() < this.tokenExpiration
    ) {
      return this.token
    }

    const key = Buffer.from(`${ACCESS_KEY_NEQUI}:${SECRET_KEY_NEQUI}`).toString(
      'base64',
    )
    const response: AxiosResponse = await axios({
      headers: {
        'Authorization': `Basic ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      url: URL_NEQUI_AUTH,
    })

    if (response.status !== 200 && response.status !== 201) {
      throw new Error('Nequi authentication failed')
    }

    const { access_token, expires_in } = response.data
    this.token = access_token
    this.tokenExpiration = Date.now() + expires_in * 1000 - 60 * 1000

    if (!this.token || !this.tokenExpiration) {
      throw new Error('Failed to retrieve Nequi token')
    }

    return this.token
  }

  private async makeRequest<T>(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const URL_NEQUI = await this.secretManager.getSecret('URL_NEQUI')
    const API_KEY_NEQUI = await this.secretManager.getSecret('API_KEY_NEQUI')

    const token = await this.getAuthToken()
    const response: AxiosResponse = await axios({
      data: JSON.stringify(body),
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-api-key': API_KEY_NEQUI,
      },
      method: 'POST',
      url: `${URL_NEQUI}${endpoint}`,
    })

    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`Nequi request failed: ${response.status}`)
    }
    return response.data
  }
}
