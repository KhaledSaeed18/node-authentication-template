/*
  Warnings:

  - You are about to drop the column `codeExpiry` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `resetPasswordCode` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `resetPasswordExpiry` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `verificationCode` on the `User` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "CodePurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "User" DROP COLUMN "codeExpiry",
DROP COLUMN "resetPasswordCode",
DROP COLUMN "resetPasswordExpiry",
DROP COLUMN "verificationCode";

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "CodePurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VerificationCode_userId_purpose_key" ON "VerificationCode"("userId", "purpose");

-- AddForeignKey
ALTER TABLE "VerificationCode" ADD CONSTRAINT "VerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
