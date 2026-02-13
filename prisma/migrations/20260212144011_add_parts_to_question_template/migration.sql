/*
  Warnings:

  - You are about to drop the column `additionalInfoType` on the `QuestionTemplate` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "QuestionTemplate" DROP COLUMN "additionalInfoType",
ADD COLUMN     "parts" JSONB;
