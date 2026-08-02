import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { OpsIncidentDetectionService } from './OpsIncidentDetectionService'

type OpsIncidentWorkerOptions = {
  pollIntervalMs?: number
}

@injectable()
export class OpsIncidentWorker {
  private isRunning = false
  private readonly logger: ScopedLogger
  private loopPromise: null | Promise<void> = null
  private readonly pollIntervalMs: number
  private wake: (() => void) | null = null

  public constructor(
    @inject(OpsIncidentDetectionService)
    private readonly detectionService: OpsIncidentDetectionService,
    @inject(TYPES.ILogger) baseLogger: ILogger,
    options: OpsIncidentWorkerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? this.readNumber('OPS_INCIDENT_SCAN_INTERVAL_MS', 300_000)
    this.logger = createScopedLogger(baseLogger, { scope: 'OpsIncidentWorker' })
  }

  public async runOnce(): Promise<void> {
    try {
      const result = await this.detectionService.sync()
      this.logger.info('Ops incident scan completed', result)
    }
    catch (error) {
      this.logger.error('Ops incident scan failed; existing incident state was preserved', error)
    }
  }

  public start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.loopPromise = this.loop()
  }

  public async stop(): Promise<void> {
    this.isRunning = false
    this.wake?.()
    if (this.loopPromise) await this.loopPromise
  }

  private async loop(): Promise<void> {
    while (this.isRunning) {
      await this.runOnce()
      if (!this.isRunning) break
      await this.sleep(this.pollIntervalMs)
    }
  }

  private readNumber(key: string, fallback: number): number {
    const value = Number(process.env[key])
    return Number.isFinite(value) && value > 0 ? value : fallback
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      this.wake = () => {
        clearTimeout(timer)
        resolve()
      }
    })
    this.wake = null
  }
}
