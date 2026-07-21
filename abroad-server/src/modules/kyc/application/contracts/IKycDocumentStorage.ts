/**
 * Storage port for identity-document images. The concrete implementation keeps
 * images in a private bucket; the bytes are only ever served back through the
 * authenticated Ops endpoint (never a public URL).
 */
export interface IKycDocumentStorage {
  download(objectKey: string): Promise<KycDocumentDownload>
  upload(params: KycDocumentUpload): Promise<string>
}

export interface KycDocumentDownload {
  buffer: Buffer
  contentType: string
}

export interface KycDocumentUpload {
  buffer: Buffer
  contentType: string
  fileExtension: string
  partnerUserId: string
}
