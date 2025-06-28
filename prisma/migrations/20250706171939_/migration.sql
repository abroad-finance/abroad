-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'PIX';

-- AlterEnum
ALTER TYPE "SupportedCurrency" ADD VALUE 'BRL';

-- AlterEnum
ALTER TYPE "TargetCurrency" ADD VALUE 'BRL';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "taxId" TEXT;
