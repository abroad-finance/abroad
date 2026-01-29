import { BigNumber, ethers } from 'ethers'

const ERC20_TRANSFER_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
] as const

const transferInterface = new ethers.utils.Interface(ERC20_TRANSFER_ABI)

type TokenTransfer = {
  amount: BigNumber
  from: string
  to: string
}

const normalizeAddress = (address: string): string => ethers.utils.getAddress(address)

export const safeNormalizeAddress = (address: null | string | undefined): null | string => {
  if (!address) return null
  try {
    return normalizeAddress(address)
  }
  catch {
    return null
  }
}

export const parseErc20Transfers = (
  receipt: ethers.providers.TransactionReceipt,
  tokenAddress: string,
): TokenTransfer[] => {
  const normalizedToken = normalizeAddress(tokenAddress)
  const transfers: TokenTransfer[] = []

  for (const log of receipt.logs) {
    const logAddress = safeNormalizeAddress(log.address)
    if (!logAddress || logAddress !== normalizedToken) {
      continue
    }

    let parsed: ethers.utils.LogDescription
    try {
      parsed = transferInterface.parseLog(log)
    }
    catch {
      continue
    }

    if (parsed.name !== 'Transfer') {
      continue
    }

    const parsedArgs = parsed.args as unknown
    if (!Array.isArray(parsedArgs) || parsedArgs.length < 3) {
      continue
    }

    const [fromRaw, toRaw, valueRaw] = parsedArgs

    if (typeof fromRaw !== 'string' || typeof toRaw !== 'string') {
      continue
    }

    if (!BigNumber.isBigNumber(valueRaw)) {
      continue
    }

    const from = safeNormalizeAddress(fromRaw)
    const to = safeNormalizeAddress(toRaw)
    if (!from || !to) {
      continue
    }

    transfers.push({
      amount: valueRaw,
      from,
      to,
    })
  }

  return transfers
}

export const sumTransfers = (transfers: TokenTransfer[]): BigNumber =>
  transfers.reduce((total, transfer) => total.add(transfer.amount), BigNumber.from(0))

export const toDecimalAmount = (amount: BigNumber, decimals: number): number => {
  const formatted = ethers.utils.formatUnits(amount, decimals)
  const parsed = Number(formatted)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid token amount: ${formatted}`)
  }
  return parsed
}
