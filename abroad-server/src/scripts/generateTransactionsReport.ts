#!/usr/bin/env -S bunx tsx

import { TransactionStatus } from '@prisma/client'
import { createObjectCsvWriter } from 'csv-writer'
import dotenv from 'dotenv'

import { PrismaClientProvider } from '../infrastructure/db'
import { IWalletHandlerFactory } from '../interfaces'
import { iocContainer } from '../ioc'
import { TYPES } from '../types'
dotenv.config()

async function generateTransactionReport() {
  const dbProvider = iocContainer.get<PrismaClientProvider>(
    TYPES.IDatabaseClientProvider,
  )
  const walletHandlerFactory = iocContainer.get<IWalletHandlerFactory>(TYPES.IWalletHandlerFactory)

  const prisma = await dbProvider.getClient()

  const transactions = await prisma.transaction.findMany({
    include: {
      partnerUser: {
        include: {
          partner: true,
        },
      },
      quote: true,
    },
    where: {
      status: TransactionStatus.PAYMENT_COMPLETED,
    },
  })

  const csvWriter = createObjectCsvWriter({
    header: [
      { id: 'consecutivo', title: 'Consecutivo' },
      { id: 'fechaTransaccion', title: 'Fecha de la transacción' },
      { id: 'tipoTransaccion', title: 'Tipo de transacción' },
      { id: 'numeroCliente', title: 'Numero del cliente' },
      {
        id: 'tipoIdentificacionCliente',
        title: 'Tipo identificación del cliente',
      },
      {
        id: 'numeroIdentificacionCliente',
        title: 'Numero identificación del cliente',
      },
      { id: 'nombresCliente', title: 'Nombres del cliente' },
      { id: 'apellidosCliente', title: 'Apellidos del cliente' },
      { id: 'nacionalidadCliente', title: 'Nacionalidad del cliente' },
      { id: 'ciudadDomicilioCliente', title: 'Ciudad domicilio del cliente' },
      { id: 'medioPago', title: 'Medio de pago' },
      { id: 'numeroWallet', title: 'Numero de wallet' },
      { id: 'codigoHash', title: 'Codigo hash de la operación' },
      { id: 'tipoActivo', title: 'Tipo de activo virtual' },
      { id: 'cantidadActivos', title: 'Cantidad de activos virtuales' },
      { id: 'valorPesos', title: 'Valor de la transaction en pesos' },
      { id: 'saldoActividadVirtual', title: 'Saldo actividad virtual' },
      { id: 'saldoPesos', title: 'Saldo en pesos' },
      { id: 'walletContraparte', title: 'Numero wallet contraparte' },
      {
        id: 'tipoIdentificacionContraparte',
        title: 'Tipo identificación contraparte',
      },
      {
        id: 'numeroIdentificacionContraparte',
        title: 'Numero identificación contraparte',
      },
      { id: 'nombresContraparte', title: 'Nombres contraparte' },
      { id: 'apellidosContraparte', title: 'Apellidos contraparte' },
      { id: 'nacionalidadContraparte', title: 'Nacionalidad contraparte' },
      { id: 'entidadPSAV', title: 'Entidad PSAV contraparte' },
      {
        id: 'paisEntidadPSAV',
        title: 'Pais donde se ubica la entidad PSAV contraparte',
      },
    ],
    path: 'transactions-report.csv',
  })

  const transactionsWithAddressFrom = await Promise.all(
    transactions.map(async (tx) => {
      if (!tx.onChainId) {
        return {
          ...tx,
          addressFrom: '', // Default value if onChainId is not available
        }
      }

      const walletHandler = walletHandlerFactory.getWalletHandler(
        tx.quote.network,
      )
      const addressFrom = await walletHandler.getAddressFromTransaction({ onChainId: tx.onChainId })

      console.log(`Transaction ID: ${tx.id}, Address From: ${addressFrom}`)
      return {
        ...tx,
        addressFrom,
      }
    },
    ))

  const records = transactionsWithAddressFrom.map(tx => ({
    apellidosCliente: '', // Not available in schema
    apellidosContraparte: '', // Not available in schema
    cantidadActivos: tx.quote.sourceAmount,
    ciudadDomicilioCliente: '', // Not available in schema
    codigoHash: tx.onChainId || '',
    consecutivo: tx.id,
    entidadPSAV: tx.partnerUser.partner.name,
    fechaTransaccion: tx.createdAt.toISOString(),
    medioPago: tx.quote.paymentMethod,
    nacionalidadCliente: 'CO', // Assuming Country.CO from Quote
    nacionalidadContraparte: 'CO', // Assuming same country
    nombresCliente: '', // Not available in schema
    nombresContraparte: '', // Not available in schema
    numeroCliente: tx.partnerUser.userId,
    numeroIdentificacionCliente: '', // Not available in schema
    numeroIdentificacionContraparte: '', // Not available in schema
    numeroWallet: tx.accountNumber,
    paisEntidadPSAV: 'CO', // Assuming Country.CO
    saldoActividadVirtual: '', // Calculated field not in schema
    saldoPesos: '', // Calculated field not in schema
    tipoActivo: tx.quote.cryptoCurrency,
    tipoIdentificacionCliente: '', // Not available in schema
    tipoIdentificacionContraparte: '', // Not available in schema
    tipoTransaccion: tx.status,
    valorPesos: tx.quote.targetAmount,
    walletContraparte: tx.addressFrom,
  }))

  await csvWriter.writeRecords(records)
  console.log('CSV report generated successfully')
}

generateTransactionReport().catch(console.error)
