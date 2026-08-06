import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

/**
 * A stand-in for Transfero Ultra, so the payout leg can complete locally.
 *
 * It answers the three calls the PIX payout path makes — balance, create
 * withdrawal, read withdrawal — with responses shaped to the schemas in
 * `transferoUltraSchemas.ts`. A withdrawal reports PROCESSING once and SETTLED
 * afterwards, so the AWAIT_PROVIDER_STATUS step has something to wait on rather
 * than completing instantly and hiding the state machine.
 */

const PORT = Number(process.env.PORT ?? 4599)

type Withdrawal = {
  amount: number
  endToEndId: string
  id: string
  pixKey: string
  polls: number
}

const withdrawals = new Map<string, Withdrawal>()

const pixEndToEndId = (): string =>
  `E${Date.now()}${Math.floor(Math.random() * 1e6).toString().padStart(6, '0')}`

const send = (res: Parameters<Parameters<typeof createServer>[0]>[1], status: number, body: unknown): void => {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(payload)
  console.log(`  → ${status} ${payload.slice(0, 120)}`)
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk as Buffer))
  req.on('end', () => {
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    console.log(`${req.method} ${url.pathname}`)

    if (url.pathname === '/api/v1/balance') {
      return send(res, 200, [{ available: 1_000_000, currency: 'BRL', total: 1_000_000 }])
    }

    if (url.pathname === '/api/v1/pix/withdrawals' && req.method === 'POST') {
      const amount = Number(body.amount ?? body.value ?? 0)
      const withdrawal: Withdrawal = {
        amount,
        endToEndId: pixEndToEndId(),
        id: randomUUID(),
        pixKey: String(body.pixKey ?? body.key ?? 'demo@abroad.finance'),
        polls: 0,
      }
      withdrawals.set(withdrawal.id, withdrawal)
      return send(res, 200, {
        amount: withdrawal.amount,
        fee: 0,
        feePercent: 0,
        id: withdrawal.id,
        netAmount: withdrawal.amount,
        pixKey: withdrawal.pixKey,
        requiresApproval: false,
        status: 'PROCESSING',
      })
    }

    const detail = /^\/api\/v1\/pix\/withdrawals\/([^/]+)$/.exec(url.pathname)
    if (detail && req.method === 'GET') {
      const withdrawal = withdrawals.get(decodeURIComponent(detail[1]))
      if (!withdrawal) return send(res, 404, { message: 'unknown withdrawal' })
      withdrawal.polls += 1
      // First read is in flight; every read after that has settled.
      const status = withdrawal.polls > 1 ? 'SETTLED' : 'PROCESSING'
      return send(res, 200, {
        amount: withdrawal.amount,
        endToEndId: status === 'SETTLED' ? withdrawal.endToEndId : null,
        fee: 0,
        id: withdrawal.id,
        netAmount: withdrawal.amount,
        pixKey: withdrawal.pixKey,
        status,
      })
    }

    send(res, 404, { message: `no mock for ${req.method} ${url.pathname}` })
  })
}).listen(PORT, () => {
  console.log(`Transfero Ultra mock listening on http://localhost:${PORT}`)
})
