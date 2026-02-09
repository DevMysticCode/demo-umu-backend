-- CreateTable
CREATE TABLE "public"."PassportCollaborator" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PassportCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PassportCollaborator_passportId_idx" ON "public"."PassportCollaborator"("passportId");

-- CreateIndex
CREATE INDEX "PassportCollaborator_userId_idx" ON "public"."PassportCollaborator"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PassportCollaborator_passportId_userId_key" ON "public"."PassportCollaborator"("passportId", "userId");

-- AddForeignKey
ALTER TABLE "public"."PassportCollaborator" ADD CONSTRAINT "PassportCollaborator_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "public"."Passport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PassportCollaborator" ADD CONSTRAINT "PassportCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
