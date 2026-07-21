import { Storage } from '@google-cloud/storage'
import crypto from 'crypto'
import { injectable } from 'inversify'

import { getKycDocumentsBucket } from '../../../app/config/kyc'
import { InfrastructureError } from '../../../core/errors'
import { IKycDocumentStorage, KycDocumentDownload, KycDocumentUpload } from '../application/contracts/IKycDocumentStorage'

/**
 * Stores KYC identity documents in a private GCS bucket. Authentication is via
 * Application Default Credentials (the runtime service account), the same
 * mechanism the pubsub and secret-manager clients already rely on — no key file.
 */
@injectable()
export class GcsKycDocumentStorage implements IKycDocumentStorage {
  private readonly storage = new Storage()

  public async download(objectKey: string): Promise<KycDocumentDownload> {
    const file = this.storage.bucket(getKycDocumentsBucket()).file(objectKey)
    try {
      const [buffer] = await file.download()
      const [metadata] = await file.getMetadata()
      return {
        buffer,
        contentType: metadata.contentType ?? 'application/octet-stream',
      }
    }
    catch (error) {
      throw new InfrastructureError('Failed to read KYC document', error)
    }
  }

  public async upload({
    buffer,
    contentType,
    fileExtension,
    partnerUserId,
  }: KycDocumentUpload): Promise<string> {
    const objectKey = `kyc/${partnerUserId}/${crypto.randomUUID()}.${fileExtension}`
    const file = this.storage.bucket(getKycDocumentsBucket()).file(objectKey)
    try {
      await file.save(buffer, {
        contentType,
        // Small one-shot uploads; resumable sessions add latency and temp state.
        resumable: false,
      })
    }
    catch (error) {
      throw new InfrastructureError('Failed to store KYC document', error)
    }
    return objectKey
  }
}
