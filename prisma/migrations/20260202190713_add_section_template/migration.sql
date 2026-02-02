-- CreateTable
CREATE TABLE "public"."SectionTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "icon" TEXT,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SectionTemplate_key_key" ON "public"."SectionTemplate"("key");

-- AddForeignKey
ALTER TABLE "public"."QuestionTemplate" ADD CONSTRAINT "QuestionTemplate_sectionKey_fkey" FOREIGN KEY ("sectionKey") REFERENCES "public"."SectionTemplate"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
