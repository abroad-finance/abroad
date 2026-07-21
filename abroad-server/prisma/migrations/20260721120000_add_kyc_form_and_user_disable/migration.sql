-- Replaces the Persona-based KYC with a self-service form.
--   * PartnerUser gains disable/enable columns (disabledAt == null means enabled)
--     so operators can block a user from all authenticated actions.
--   * PartnerUserKyc gains the structured form fields; a complete submission is
--     auto-approved. The old Persona columns (externalId, link) become nullable and
--     are retained only for historical rows (no longer written).

-- CreateEnum
CREATE TYPE "public"."DocumentType" AS ENUM ('NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE', 'FOREIGN_ID', 'OTHER');

-- AlterTable
ALTER TABLE "public"."PartnerUser" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "disabledBy" TEXT,
ADD COLUMN     "disabledReason" TEXT;

-- AlterTable
ALTER TABLE "public"."PartnerUserKyc" ADD COLUMN     "address" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "documentImagePath" TEXT,
ADD COLUMN     "documentNumber" TEXT,
ADD COLUMN     "documentType" "public"."DocumentType",
ADD COLUMN     "email" TEXT,
ADD COLUMN     "fullName" TEXT,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ALTER COLUMN "externalId" DROP NOT NULL,
ALTER COLUMN "link" DROP NOT NULL;
