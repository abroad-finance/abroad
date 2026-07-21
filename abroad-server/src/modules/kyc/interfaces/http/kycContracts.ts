import { DocumentType, KycStatus } from '@prisma/client'
import { z } from 'zod'

export interface KycStatusResponse {
  hasApproved: boolean
  status: KycStatus | null
}

export interface KycSubmitResponse {
  status: KycStatus
}

const requiredString = (label: string) => z.string().trim().min(1, `${label} is required`)

/**
 * Validates the self-service KYC form. Fields arrive as multipart form strings,
 * so dates/enums are coerced here. A submission that passes every check is
 * auto-approved by the service.
 */
export const kycSubmissionFormSchema = z.object({
  address: requiredString('Address'),
  city: requiredString('City'),
  dateOfBirth: z.coerce
    .date()
    .refine(value => value.getTime() < Date.now(), 'Date of birth must be in the past'),
  documentNumber: requiredString('Document number'),
  documentType: z.nativeEnum(DocumentType),
  email: z.string().trim().email(),
  fullName: requiredString('Full name'),
  nationality: requiredString('Nationality'),
  phone: requiredString('Phone'),
  userId: requiredString('User id'),
})

const ACCEPTED_IMAGE_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/heic': 'heic',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * Maps an uploaded document's mime type to a file extension, rejecting anything
 * that is not an accepted image/PDF.
 */
export const resolveDocumentExtension = (mimeType: string): null | string => {
  return ACCEPTED_IMAGE_MIME_TYPES[mimeType] ?? null
}
