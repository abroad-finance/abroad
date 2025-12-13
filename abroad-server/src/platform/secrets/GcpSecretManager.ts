// src/platform/secrets/GcpSecretManager.ts
import { SecretManagerServiceClient } from '@google-cloud/secret-manager'
import dotenv from 'dotenv'
import { isAvailable, project } from 'gcp-metadata'
import { injectable } from 'inversify'

import { ISecretManager, Secret } from './ISecretManager'

dotenv.config()

@injectable()
export class GcpSecretManager implements ISecretManager {
  private cachedProjectId: null | string = null
  private secretClient: SecretManagerServiceClient

  constructor() {
    this.secretClient = new SecretManagerServiceClient()
  }

  /**
   * Fetches the secret from GCP Secret Manager or from environment variables in development.
   */
  async getSecret(secretName: Secret): Promise<string> {
    // In development, attempt to fetch from process.env.
    if (process.env.NODE_ENV === 'development') {
      const secretValue = process.env[secretName]
      if (secretValue) {
        return secretValue
      }
    }

    if (secretName === 'GCP_PROJECT_ID') {
      const projectId = await this.getProjectId()
      if (!projectId) {
        throw new Error('Project ID not found in GCP metadata.')
      }
      return projectId
    }

    // Fetch secret from GCP Secret Manager.
    const projectId = await this.getProjectId()
    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`
    const [accessResponse] = await this.secretClient.accessSecretVersion({
      name,
    })
    const payload = accessResponse.payload?.data?.toString()

    if (!payload) {
      throw new Error(`No secret payload found for secret "${secretName}"`)
    }

    return payload
  }

  getSecrets<T extends readonly Secret[]>(secretNames: T): Promise<Record<T[number], string>> {
    return Promise.all(secretNames.map(name => this.getSecret(name)))
      .then((secrets) => {
        const result: Record<string, string> = {}
        secretNames.forEach((name, index) => {
          result[name] = secrets[index]
        })
        return result as Record<T[number], string>
      })
      .catch((error) => {
        throw new Error(`Failed to retrieve secrets: ${error.message}`)
      })
  }

  /**
   * Retrieves the project ID from environment or metadata.
   */
  private async getProjectId(): Promise<null | string> {
    if (this.cachedProjectId) {
      return this.cachedProjectId
    }

    if (process.env.NODE_ENV === 'development') {
      if (!process.env.PROJECT_ID) {
        throw new Error('PROJECT_ID is not defined in development mode.')
      }
      return process.env.PROJECT_ID
    }

    if (await isAvailable()) {
      this.cachedProjectId = await project('project-id')
      return this.cachedProjectId
    }
    else {
      throw new Error('GCP not available')
    }
  }
}
