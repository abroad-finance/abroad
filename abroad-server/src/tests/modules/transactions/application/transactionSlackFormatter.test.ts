import {
  BlockchainNetwork,
  CryptoCurrency,
  PaymentMethod,
  TargetCurrency,
  TransactionStatus,
  Country,
} from '@prisma/client'

import { buildTransactionSlackMessage } from '../../../../modules/transactions/application/transactionSlackFormatter'
import { TransactionWithRelations } from '../../../../modules/transactions/application/transactionNotificationTypes'

const buildTransaction = (overrides: Partial<TransactionWithRelations> = {}): TransactionWithRelations => ({
  accountNumber: '123456789',
  bankCode: 'bank-1',
  createdAt: new Date(),
  externalId: 'external-1',
  id: 'txn-1',
  onChainId: 'on-chain-1',
  partnerUserId: 'partner-user-1',
  partnerUser: {
    createdAt: new Date(),
    id: 'partner-user-1',
    kycExternalToken: null,
    partner: {
      apiKey: null,
      clientDomainHash: null,
      country: Country.CO,
      createdAt: new Date(),
      email: 'partner@example.com',
      firstName: 'Pat',
      id: 'partner-1',
      isKybApproved: true,
      lastName: 'Ner',
      name: 'Partner',
      needsKyc: true,
      phone: null,
      webhookUrl: 'http://hook',
    },
    partnerId: 'partner-1',
    updatedAt: new Date(),
    userId: 'user-1',
  },
  quote: {
    country: Country.CO,
    createdAt: new Date(),
    cryptoCurrency: CryptoCurrency.USDC,
    expirationDate: new Date(Date.now() + 1000),
    id: 'quote-1',
    network: BlockchainNetwork.STELLAR,
    partnerId: 'partner-1',
    paymentMethod: PaymentMethod.NEQUI,
    sourceAmount: 10,
    targetAmount: 20,
    targetCurrency: TargetCurrency.COP,
    updatedAt: new Date(),
  },
  quoteId: 'quote-1',
  refundOnChainId: 'refund-1',
  status: TransactionStatus.PAYMENT_COMPLETED,
  taxId: null,
  qrCode: null,
  ...overrides,
})

describe('transactionSlackFormatter', () => {
  it('renders full detail including references and notes', () => {
    const transaction = buildTransaction()
    const message = buildTransactionSlackMessage(transaction, {
      heading: 'Payment completed',
      notes: {
        provider: 'transfero',
        providerAmount: 10,
        providerStatus: 'processed',
      },
      status: TransactionStatus.PAYMENT_COMPLETED,
      trigger: 'TransactionFormatterTest',
    })

    expect(message).toContain('✅ Payment completed | Status: PAYMENT_COMPLETED | Trigger: TransactionFormatterTest')
    expect(message).toContain(`Transaction: ${transaction.id}`)
    expect(message).toContain(`Quote: ${transaction.quote.id}`)
    expect(message).toContain(`Partner: ${transaction.partnerUser.partner.name} (${transaction.partnerUser.partner.id})`)
    expect(message).toContain('Amounts: 10 USDC -> 20 COP')
    expect(message).toContain('Payment: NEQUI | Network: STELLAR | Account: 123456789 | Bank: bank-1')
    expect(message).toContain('References: External: external-1 | On-chain: on-chain-1 | Refund: refund-1')
    expect(message).toContain('Notes: provider: transfero | providerAmount: 10 | providerStatus: processed')
  })

  it('omits optional sections when data is absent', () => {
    const transaction = buildTransaction({
      accountNumber: '',
      bankCode: '',
      externalId: null,
      onChainId: null,
      refundOnChainId: null,
    })

    const message = buildTransactionSlackMessage(transaction, {
      heading: 'Payment failed',
      status: TransactionStatus.PAYMENT_FAILED,
      trigger: 'TransactionFormatterTest',
    })

    expect(message).not.toContain('Account:')
    expect(message).not.toContain('Bank:')
    expect(message).not.toContain('References:')
    expect(message).not.toContain('Notes:')
    expect(message).toContain('Payment: NEQUI | Network: STELLAR')
    expect(message).toContain('❌ Payment failed | Status: PAYMENT_FAILED | Trigger: TransactionFormatterTest')
  })
})
