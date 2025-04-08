import { CryptoCurrency } from '@prisma/client'

export interface IWalletHandler {
  send(
    {
      address,
      amount,
      cryptoCurrency,
    }: {
      address: string
      amount: number
      cryptoCurrency: CryptoCurrency
    }
  ): Promise<{ success: boolean, transactionId?: string }>
}
