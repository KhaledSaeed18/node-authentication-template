-- AlterEnum
ALTER TYPE "CodePurpose" ADD VALUE 'EMAIL_CHANGE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pendingEmail" TEXT;

