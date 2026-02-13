-- AlterTable
ALTER TABLE "QuestionTemplate" ADD COLUMN     "buttonText" TEXT,
ADD COLUMN     "fields" JSONB,
ADD COLUMN     "repeatable" BOOLEAN;
