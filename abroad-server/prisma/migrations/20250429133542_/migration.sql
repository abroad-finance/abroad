-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "isKybApproved" BOOLEAN DEFAULT false,
ADD COLUMN     "needsKyc" BOOLEAN DEFAULT true;
