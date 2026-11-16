/*
  Warnings:

  - Added the required column `tenantEmail` to the `TenancySignLink` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TenancySignLink" ADD COLUMN     "otpAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "otpCode" TEXT,
ADD COLUMN     "otpExpiresAt" TIMESTAMP(3),
ADD COLUMN     "otpSentAt" TIMESTAMP(3),
ADD COLUMN     "tenantEmail" TEXT NOT NULL;
