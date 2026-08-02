import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { OpsConfigurationReleaseService } from './OpsConfigurationReleaseService'

type OpsConfigurationReleaseWorkerOptions = {
  pollIntervalMs?: number
}

@injectable()
export class OpsConfigurationReleaseWorker {
  private isRunning = false
  private readonly logger: ScopedLogger
  private loopPromise: null | Promise<void> = null
  private readonly pollIntervalMs: number
  private wake: (() => void) | null = null

  public constructor(
    @inject(OpsConfigurationReleaseService)
    private readonly releaseService: OpsConfigurationReleaseService,
    @inject(TYPES.ILogger) baseLogger: ILogger,
    options: OpsConfigurationReleaseWorkerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs
      ?? this.readNumber('OPS_CONFIGURATION_RELEASE_INTERVAL_MS', 60_000)
    this.logger = createScopedLogger(baseLogger, { scope: 'OpsConfigurationReleaseWorker' })
  }

  public async runOnce(): Promise<void> {
    try {
      const applied = await this.releaseService.applyDue()
      if (applied > 0) this.logger.info('Scheduled configuration releases applied', { applied })
    }
    catch (error) {
      this.logger.error('Scheduled configuration release scan failed', error)
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
    const parsed = Number(process.env[key])
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
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
