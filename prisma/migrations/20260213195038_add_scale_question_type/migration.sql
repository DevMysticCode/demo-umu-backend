-- AlterEnum
ALTER TYPE "QuestionType" ADD VALUE 'SCALE';

-- AlterTable
ALTER TABLE "QuestionTemplate" ADD COLUMN     "scaleMax" INTEGER,
ADD COLUMN     "scaleMin" INTEGER,
ADD COLUMN     "scaleStep" INTEGER;
