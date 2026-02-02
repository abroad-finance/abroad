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

export const fetchErc20Decimals = async (
  provider: ethers.providers.JsonRpcProvider,
  tokenAddress: string,
): Promise<number> => {
  const erc20 = new ethers.Contract(
    tokenAddress,
    ['function decimals() view returns (uint8)'],
    provider,
  )

  const raw = (await erc20.decimals()) as unknown

  let decimals: null | number = null
  if (typeof raw === 'number') {
    decimals = raw
  }
  else if (BigNumber.isBigNumber(raw)) {
    decimals = raw.toNumber()
  }
  else if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isInteger(parsed)) {
      decimals = parsed
    }
  }

  if (decimals === null || !Number.isInteger(decimals) || decimals < 0) {
    throw new Error('Invalid token decimals returned from contract')
  }

  return decimals
}
