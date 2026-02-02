-- CreateEnum
CREATE TYPE "public"."PassportStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."SectionStatus" AS ENUM ('LOCKED', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."TaskStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."QuestionStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."QuestionType" AS ENUM ('TEXT', 'RADIO', 'CHECKBOX', 'UPLOAD', 'MULTIPART', 'NOTE', 'DATE');

-- CreateTable
CREATE TABLE "public"."Passport" (
    "id" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "public"."PassportStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Passport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PassportSection" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "imageKey" TEXT,
    "order" INTEGER NOT NULL,
    "status" "public"."SectionStatus" NOT NULL DEFAULT 'LOCKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PassportSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PassportSectionTask" (
    "id" TEXT NOT NULL,
    "passportSectionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "order" INTEGER NOT NULL,
    "status" "public"."TaskStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PassportSectionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."QuestionTemplate" (
    "id" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "instructionText" TEXT,
    "helpText" TEXT,
    "type" "public"."QuestionType" NOT NULL,
    "options" JSONB,
    "placeholder" TEXT,
    "displayMode" TEXT,
    "uploadInstruction" TEXT,
    "prewrittenTemplates" JSONB,
    "dateFields" JSONB,
    "points" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PassportQuestion" (
    "id" TEXT NOT NULL,
    "passportSectionTaskId" TEXT NOT NULL,
    "questionTemplateId" TEXT NOT NULL,
    "status" "public"."QuestionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PassportQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."QuestionAnswer" (
    "id" TEXT NOT NULL,
    "passportQuestionId" TEXT NOT NULL,
    "answerText" TEXT,
    "answerJson" JSONB,
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Passport_addressLine1_key" ON "public"."Passport"("addressLine1");

-- CreateIndex
CREATE INDEX "Passport_ownerId_idx" ON "public"."Passport"("ownerId");

-- CreateIndex
CREATE INDEX "PassportSection_passportId_idx" ON "public"."PassportSection"("passportId");

-- CreateIndex
CREATE UNIQUE INDEX "PassportSection_passportId_key_key" ON "public"."PassportSection"("passportId", "key");

-- CreateIndex
CREATE INDEX "PassportSectionTask_passportSectionId_idx" ON "public"."PassportSectionTask"("passportSectionId");

-- CreateIndex
CREATE UNIQUE INDEX "PassportSectionTask_passportSectionId_key_key" ON "public"."PassportSectionTask"("passportSectionId", "key");

-- CreateIndex
CREATE INDEX "QuestionTemplate_sectionKey_taskKey_idx" ON "public"."QuestionTemplate"("sectionKey", "taskKey");

-- CreateIndex
CREATE INDEX "PassportQuestion_passportSectionTaskId_idx" ON "public"."PassportQuestion"("passportSectionTaskId");

-- CreateIndex
CREATE INDEX "PassportQuestion_questionTemplateId_idx" ON "public"."PassportQuestion"("questionTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionAnswer_passportQuestionId_key" ON "public"."QuestionAnswer"("passportQuestionId");

-- AddForeignKey
ALTER TABLE "public"."Passport" ADD CONSTRAINT "Passport_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PassportSection" ADD CONSTRAINT "PassportSection_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "public"."Passport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PassportSectionTask" ADD CONSTRAINT "PassportSectionTask_passportSectionId_fkey" FOREIGN KEY ("passportSectionId") REFERENCES "public"."PassportSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PassportQuestion" ADD CONSTRAINT "PassportQuestion_passportSectionTaskId_fkey" FOREIGN KEY ("passportSectionTaskId") REFERENCES "public"."PassportSectionTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PassportQuestion" ADD CONSTRAINT "PassportQuestion_questionTemplateId_fkey" FOREIGN KEY ("questionTemplateId") REFERENCES "public"."QuestionTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."QuestionAnswer" ADD CONSTRAINT "QuestionAnswer_passportQuestionId_fkey" FOREIGN KEY ("passportQuestionId") REFERENCES "public"."PassportQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
