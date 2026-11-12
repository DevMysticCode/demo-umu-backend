-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('SIGNUP', 'RESET');

-- CreateEnum
CREATE TYPE "PassportEventActorType" AS ENUM ('OWNER', 'COLLABORATOR', 'SYSTEM', 'ADMIN', 'SOURCE');

-- CreateEnum
CREATE TYPE "PassportEventVisibility" AS ENUM ('OWNER_ONLY', 'COLLABORATOR', 'BUYER', 'PUBLIC');

-- CreateEnum
CREATE TYPE "PassportActionStatus" AS ENUM ('OPEN', 'ADDRESSED', 'SUPERSEDED', 'REOPENED');

-- CreateEnum
CREATE TYPE "DocumentVersionAction" AS ENUM ('UPLOADED', 'REPLACED', 'REMOVED');

-- CreateEnum
CREATE TYPE "LedgerEntryStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "JourneyType" AS ENUM ('OWNER', 'BUYER', 'TENANT', 'LANDLORD', 'GLOBAL');

-- CreateEnum
CREATE TYPE "StampVerificationStatus" AS ENUM ('EARNED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "DocumentAccessLevel" AS ENUM ('PRIVATE', 'SELECTED', 'ELIGIBLE', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "PassportType" AS ENUM ('SELLER', 'LANDLORD', 'BUYER', 'TENANT');

-- CreateEnum
CREATE TYPE "SectionVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "OwnershipVerificationStatus" AS ENUM ('SUBMITTED', 'IN_PROGRESS', 'VERIFIED', 'FAILED', 'ADDITIONAL_INFO_NEEDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PassportStatus" ADD VALUE 'PENDING_PAYMENT';
ALTER TYPE "PassportStatus" ADD VALUE 'PUBLISHED';

-- DropIndex
DROP INDEX "Passport_addressLine1_key";

-- AlterTable
ALTER TABLE "OtpCode" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "purpose" "OtpPurpose" NOT NULL DEFAULT 'SIGNUP';

-- AlterTable
ALTER TABLE "Passport" ADD COLUMN     "convertedFromId" TEXT,
ADD COLUMN     "isHmo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastVisitedAt" TIMESTAMP(3),
ADD COLUMN     "lastVisitedTaskId" TEXT,
ADD COLUMN     "propertyId" TEXT,
ADD COLUMN     "publicVisibility" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicVisibilitySetAt" TIMESTAMP(3),
ADD COLUMN     "type" "PassportType";

-- AlterTable
ALTER TABLE "PassportCollaborator" ADD COLUMN     "accessDuration" TEXT DEFAULT 'until_removed',
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "historyAccess" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "permission" TEXT DEFAULT 'view',
ADD COLUMN     "role" TEXT,
ADD COLUMN     "sectionKeys" JSONB,
ADD COLUMN     "taskKeys" JSONB;

-- AlterTable
ALTER TABLE "PassportSection" ADD COLUMN     "visibility" "SectionVisibility" NOT NULL DEFAULT 'PUBLIC';

-- AlterTable
ALTER TABLE "QuestionAnswer" ADD COLUMN     "accessLevel" "DocumentAccessLevel" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN     "lastEditedByUserId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "QuestionTemplate" ADD COLUMN     "helpContent" JSONB,
ADD COLUMN     "helpVideoUrl" TEXT,
ADD COLUMN     "readiness" JSONB;

-- AlterTable
ALTER TABLE "SectionTemplate" ADD COLUMN     "conditionalKey" TEXT,
ADD COLUMN     "helpContent" JSONB,
ADD COLUMN     "helpVideoUrl" TEXT,
ADD COLUMN     "type" "PassportType" NOT NULL DEFAULT 'SELLER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "contactVisible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "currentStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailNewsletter" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kycCompletedAt" TIMESTAMP(3),
ADD COLUMN     "kycInquiryId" TEXT,
ADD COLUMN     "kycStatus" TEXT,
ADD COLUMN     "lastActiveDate" TIMESTAMP(3),
ADD COLUMN     "longestStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "pushNotifications" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rewardPointsBalance" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "smsNotifications" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FounderNumber" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FounderNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserInterest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "interestIds" TEXT[],
    "areas" TEXT[],
    "emailOptIn" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "deviceId" TEXT,
    "endpointArn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "userId" TEXT,
    "propertyId" TEXT,
    "postcode" TEXT,
    "contact" JSONB,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT,
    "county" TEXT,
    "postcode" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCompany" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "companyNumber" TEXT,
    "director" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chStatus" TEXT,
    "chCompanyName" TEXT,
    "chVerifiedAt" TIMESTAMP(3),
    "chVerifyError" TEXT,

    CONSTRAINT "UserCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSolicitor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSolicitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsedResetToken" (
    "jti" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsedResetToken_pkey" PRIMARY KEY ("jti")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedByTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "udprn" TEXT,
    "uprn" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT,
    "county" TEXT,
    "postcode" TEXT NOT NULL,
    "nation" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "propertyType" TEXT,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "sqft" INTEGER,
    "floorAreaSqm" DOUBLE PRECISION,
    "epcRating" TEXT,
    "epcScore" INTEGER,
    "heatingType" TEXT,
    "co2Emissions" DOUBLE PRECISION,
    "tenure" TEXT,
    "yearBuilt" INTEGER,
    "estimatedPrice" DOUBLE PRECISION,
    "lastSoldPrice" DOUBLE PRECISION,
    "lastSoldDate" TIMESTAMP(3),
    "councilTaxBand" TEXT,
    "councilTaxAnnual" DOUBLE PRECISION,
    "councilTaxCouncilName" TEXT,
    "councilTaxRef" TEXT,
    "councilTaxYear" TEXT,
    "councilTaxCouncilWeb" TEXT,
    "councilTaxFetchedAt" TIMESTAMP(3),
    "floodRisk" TEXT,
    "floodRiskEnrichedAt" TIMESTAMP(3),
    "imageUrl" TEXT,
    "images" JSONB,
    "titleNumber" TEXT,
    "epcEnrichedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heatingCostCurrent" DOUBLE PRECISION,
    "hotWaterCostCurrent" DOUBLE PRECISION,
    "lightingCostCurrent" DOUBLE PRECISION,
    "heatingCostPotential" DOUBLE PRECISION,
    "hotWaterCostPotential" DOUBLE PRECISION,
    "lightingCostPotential" DOUBLE PRECISION,
    "co2EmissionsPotential" DOUBLE PRECISION,
    "epcRatingPotential" TEXT,
    "epcScorePotential" INTEGER,
    "wallsEnergyEff" TEXT,
    "wallsDescription" TEXT,
    "roofEnergyEff" TEXT,
    "roofDescription" TEXT,
    "floorEnergyEff" TEXT,
    "floorDescription" TEXT,
    "windowsEnergyEff" TEXT,
    "windowsDescription" TEXT,
    "glazedArea" TEXT,
    "multiGlazeProportion" DOUBLE PRECISION,
    "mainheatEnergyEff" TEXT,
    "mainheatDescription" TEXT,
    "mainheatcEnergyEff" TEXT,
    "hotWaterEnergyEff" TEXT,
    "hotwaterDescription" TEXT,
    "secondheatDescription" TEXT,
    "mainheatcontDescription" TEXT,
    "mechanicalVentilation" TEXT,
    "lightingEnergyEff" TEXT,
    "lowEnergyLighting" DOUBLE PRECISION,
    "photoSupply" DOUBLE PRECISION,
    "solarWaterHeatingFlag" TEXT,
    "windTurbineCount" INTEGER,
    "lodgementDate" TEXT,
    "constructionAgeBand" TEXT,
    "builtForm" TEXT,
    "epcLmkKey" TEXT,
    "epcRecommendations" JSONB,
    "actualEnergySpend" DOUBLE PRECISION,
    "actualGasSpend" DOUBLE PRECISION,
    "actualElectricitySpend" DOUBLE PRECISION,
    "actualBillSupplier" TEXT,
    "actualBillPeriod" TEXT,
    "actualBillRawText" TEXT,
    "actualBillUploadedAt" TIMESTAMP(3),

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertySearchLog" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertySearchLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnershipVerification" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "OwnershipVerificationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "verificationMethod" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "passportId" TEXT,
    "landRegistryMessageId" TEXT,
    "landRegistryTitleNumber" TEXT,
    "landRegistryMatchResult" TEXT,
    "landRegistryRawResponse" JSONB,
    "landRegistryCheckedAt" TIMESTAMP(3),
    "kycAlreadyVerifiedAtStart" BOOLEAN,
    "hmlrAlreadyVerifiedAtStart" BOOLEAN,

    CONSTRAINT "OwnershipVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" JSONB,
    "buyingTimeline" TEXT,
    "budgetMin" DOUBLE PRECISION,
    "budgetMax" DOUBLE PRECISION,
    "propertyTypes" JSONB,
    "propertyStyles" JSONB,
    "importantFeatures" JSONB,
    "sellingTimeline" TEXT,
    "propertyValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassportCollection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PassportCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassportCollectionItem" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,

    CONSTRAINT "PassportCollectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassportCollaboratorInvite" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "sectionKeys" JSONB,
    "taskKeys" JSONB,
    "historyAccess" BOOLEAN NOT NULL DEFAULT true,
    "permission" TEXT DEFAULT 'view',
    "accessDuration" TEXT DEFAULT 'until_removed',
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "PassportCollaboratorInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCollaborator" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "collaboratorId" TEXT NOT NULL,
    "role" TEXT,
    "permission" TEXT DEFAULT 'all',
    "propertyIds" JSONB,
    "accessDuration" TEXT DEFAULT 'permanent',
    "expiresAt" TIMESTAMP(3),
    "clientAccess" TEXT DEFAULT 'shared',
    "allowComms" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerPassportAccess" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerPassportAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassportActivity" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "icon" TEXT,
    "hash" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PassportActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassportEvent" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" TEXT NOT NULL,
    "actorType" "PassportEventActorType" NOT NULL,
    "actorId" TEXT,
    "actingOnBehalfOf" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "sectionId" TEXT,
    "sourceType" TEXT,
    "beforeRef" JSONB,
    "afterRef" JSONB,
    "visibilityClass" "PassportEventVisibility" NOT NULL DEFAULT 'OWNER_ONLY',
    "correlationId" TEXT,
    "ruleId" TEXT,
    "ruleVersion" INTEGER,
    "metadata" JSONB,

    CONSTRAINT "PassportEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassportRule" (
    "id" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "jurisdiction" TEXT,
    "questionIds" JSONB NOT NULL,
    "conditionExpression" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "userTitle" TEXT NOT NULL,
    "userExplanation" TEXT NOT NULL,
    "followUpQuestionIds" JSONB,
    "acceptedEvidenceTypes" JSONB,
    "suggestedSteps" JSONB,
    "actionType" TEXT,
    "professionalReviewFlag" BOOLEAN NOT NULL DEFAULT false,
    "sourceReference" TEXT,
    "contentReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PassportRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassportAction" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "subjectEntityId" TEXT NOT NULL,
    "status" "PassportActionStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "suggestedSteps" JSONB,
    "severity" TEXT,
    "linkedQuestionId" TEXT,
    "linkedAnswerRef" JSONB,
    "supersededByActionId" TEXT,
    "supersedesReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "addressedAt" TIMESTAMP(3),
    "addressedBy" TEXT,

    CONSTRAINT "PassportAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "name" TEXT,
    "action" "DocumentVersionAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "passportQuestionId" TEXT,
    "actionKey" TEXT,
    "subjectId" TEXT,
    "journeyType" "JourneyType",
    "passportId" TEXT,
    "propertyId" TEXT,
    "status" "LedgerEntryStatus" NOT NULL DEFAULT 'CONFIRMED',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardAction" (
    "id" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "journeyType" "JourneyType" NOT NULL,
    "label" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "stampKey" TEXT,
    "firstTimeOnly" BOOLEAN NOT NULL DEFAULT true,
    "verificationRequired" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StampDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "journeyType" "JourneyType" NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "checklistItems" JSONB,
    "iconAsset" TEXT,
    "tier" INTEGER DEFAULT 1,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StampDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserStamp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stampDefinitionId" TEXT NOT NULL,
    "passportId" TEXT,
    "propertyId" TEXT,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pointsAwarded" INTEGER,
    "celebratedAt" TIMESTAMP(3),
    "verificationStatus" "StampVerificationStatus" NOT NULL DEFAULT 'EARNED',
    "triggerEvent" TEXT,
    "supportingDocumentIds" JSONB,

    CONSTRAINT "UserStamp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardCatalogueItem" (
    "id" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "pointsRequired" INTEGER NOT NULL,
    "iconAsset" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardCatalogueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionSourceMapping" (
    "id" TEXT NOT NULL,
    "sourceParagraph" INTEGER NOT NULL,
    "sourceQuestionId" INTEGER,
    "section" TEXT NOT NULL,
    "sourceQuestionText" TEXT NOT NULL,
    "pdtfPath" TEXT,
    "baspi5Ref" TEXT,
    "ta6Ref" TEXT,
    "ta7Ref" TEXT,
    "ta10Ref" TEXT,
    "liveQuestionTemplateId" TEXT,
    "matchConfidence" TEXT,
    "matchNotes" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "recommendedCondition" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionSourceMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionAnswerGuidance" (
    "id" TEXT NOT NULL,
    "sourceParagraph" INTEGER NOT NULL,
    "parentSourceParagraph" INTEGER,
    "nodeType" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "sourceQuestionText" TEXT NOT NULL,
    "answerValue" TEXT NOT NULL,
    "answerValueProvenance" TEXT,
    "outcomeCode" TEXT,
    "ownerExplanation" TEXT NOT NULL,
    "ownerNextStep" TEXT,
    "evidenceToAdd" TEXT,
    "timeIfUnresolved" TEXT,
    "nextPromptParagraphs" JSONB,
    "copyDepth" TEXT,
    "panel" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "blockReason" TEXT,
    "sourceFileVersion" TEXT NOT NULL,
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionAnswerGuidance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResolutionPathway" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issue" TEXT NOT NULL,
    "whyItMatters" TEXT NOT NULL,
    "timeNow" TEXT NOT NULL,
    "timeAtSale" TEXT NOT NULL,
    "checkFirst" TEXT NOT NULL,
    "startStep" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "handover" JSONB,
    "stopPoint" TEXT,
    "toValidate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "validatedBy" TEXT,
    "validatedOn" TIMESTAMP(3),
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "sourceFileVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResolutionPathway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PathwayQuestionLink" (
    "id" TEXT NOT NULL,
    "pathwayId" TEXT NOT NULL,
    "sourceParagraph" INTEGER,
    "sourceQuestionId" INTEGER,
    "section" TEXT NOT NULL,
    "sourceQuestionText" TEXT NOT NULL,
    "cleanAnswer" TEXT NOT NULL,
    "triggerAnswer" TEXT NOT NULL,
    "pdtfPath" TEXT,
    "baspi5Ref" TEXT,
    "ta6Ref" TEXT,
    "ta7Ref" TEXT,
    "ta10Ref" TEXT,

    CONSTRAINT "PathwayQuestionLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PathwayJourney" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "pathwayId" TEXT NOT NULL,
    "triggerQuestionTemplateId" TEXT,
    "contentVersion" INTEGER NOT NULL,
    "currentStepId" TEXT NOT NULL,
    "stepAnswers" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PathwayJourney_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWishlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWishlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSavedProperty" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSavedProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecentlyViewedProperty" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecentlyViewedProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyWatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT true,
    "progress" BOOLEAN NOT NULL DEFAULT true,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "comparables" BOOLEAN NOT NULL DEFAULT false,
    "homescore" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT,
    "repeats" TEXT NOT NULL DEFAULT 'never',
    "notes" TEXT,
    "type" TEXT NOT NULL DEFAULT 'manual',
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "tags" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT,
    "passportId" TEXT,
    "accessLevel" "DocumentAccessLevel" NOT NULL DEFAULT 'PRIVATE',
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "UserDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAccessGrant" (
    "id" TEXT NOT NULL,
    "questionAnswerId" TEXT,
    "userDocumentId" TEXT,
    "collaboratorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareManifestDocument" (
    "id" TEXT NOT NULL,
    "sharedPassportLinkId" TEXT,
    "buyerPassportAccessId" TEXT,
    "questionAnswerId" TEXT,
    "userDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareManifestDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportRequest" (
    "id" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "thumbnail" TEXT,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 15,
    "category" TEXT,
    "tags" TEXT[],
    "order" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "positionSecs" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeScoreResult" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "rating" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "tier" TEXT,
    "baseBill" DOUBLE PRECISION,
    "adjustedBill" DOUBLE PRECISION,
    "actualBill" DOUBLE PRECISION,
    "costPerSqm" DOUBLE PRECISION,
    "neighbourMedian" DOUBLE PRECISION,
    "billDifference" DOUBLE PRECISION,
    "costEfficiency" DOUBLE PRECISION,
    "insulation" DOUBLE PRECISION,
    "heating" DOUBLE PRECISION,
    "controls" DOUBLE PRECISION,
    "ventilation" DOUBLE PRECISION,
    "lighting" DOUBLE PRECISION,
    "renewableBonus" DOUBLE PRECISION,
    "heatingV1" INTEGER,
    "structure" INTEGER,
    "efficiency" INTEGER,
    "electrics" INTEGER,
    "plumbing" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "HomeScoreResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkType" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "upliftLow" DOUBLE PRECISION,
    "upliftHigh" DOUBLE PRECISION,
    "isMinor" BOOLEAN NOT NULL DEFAULT false,
    "epcAssessed" BOOLEAN NOT NULL DEFAULT false,
    "docRequired" TEXT,
    "warningText" TEXT,
    "isCommon" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WorkType_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "PropertyWork" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workTypeCode" TEXT NOT NULL,
    "verificationState" TEXT NOT NULL DEFAULT 'self',
    "evidenceUrl" TEXT,
    "installDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValuationSnapshot" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "baseline" DOUBLE PRECISION NOT NULL,
    "estimateLow" DOUBLE PRECISION NOT NULL,
    "estimateHigh" DOUBLE PRECISION NOT NULL,
    "estimatePoint" DOUBLE PRECISION NOT NULL,
    "provedCount" INTEGER NOT NULL,
    "scoringCount" INTEGER NOT NULL,
    "derisked" INTEGER NOT NULL,
    "recorded" INTEGER NOT NULL,
    "flagged" INTEGER NOT NULL,
    "epcSuppressed" BOOLEAN NOT NULL DEFAULT false,
    "contributions" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "inputsHash" TEXT NOT NULL,
    "isHomeowner" BOOLEAN,
    "isLandlord" BOOLEAN,
    "purpose" TEXT,
    "foundNextHome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValuationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenancySignLink" (
    "id" TEXT NOT NULL,
    "passportQuestionId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'tenancy',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenancySignLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedPassportLink" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'buyer',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedPassportLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerNote" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sectionKey" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicRef" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "tierPaidAt" TIMESTAMP(3),
    "tierPaymentId" TEXT,
    "idDocumentType" TEXT,
    "idDocumentUrl" TEXT,
    "idVerified" BOOLEAN NOT NULL DEFAULT false,
    "idVerificationProvider" TEXT,
    "idVerificationId" TEXT,
    "idVerifiedAt" TIMESTAMP(3),
    "fundsType" TEXT,
    "fundsAmount" INTEGER,
    "fundsDocumentUrl" TEXT,
    "fundsReviewStatus" TEXT,
    "fundsVerified" BOOLEAN NOT NULL DEFAULT false,
    "fundsProvider" TEXT,
    "fundsVerificationId" TEXT,
    "fundsVerifiedAt" TIMESTAMP(3),
    "fundsAmountVerified" INTEGER,
    "amlStatus" TEXT,
    "affordabilityScore" INTEGER,
    "sourceOfFundsJson" JSONB,
    "mortgageAipUrl" TEXT,
    "mortgageAipReviewStatus" TEXT,
    "mortgageAipVerified" BOOLEAN NOT NULL DEFAULT false,
    "mortgageAipVerifiedAt" TIMESTAMP(3),
    "chainPosition" TEXT,
    "solicitorStatus" TEXT,
    "timeline" TEXT,
    "propertyType" TEXT,
    "statement" TEXT,
    "signatureData" TEXT,
    "signedName" TEXT,
    "signedAt" TIMESTAMP(3),
    "completedSteps" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "strengthScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifierOrg" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "logoEmoji" TEXT,
    "description" TEXT,
    "fcaNumber" TEXT,
    "contactEmail" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerifierOrg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifierClient" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretHash" TEXT NOT NULL,
    "redirectUris" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedScopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "VerifierClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "buyerUserId" TEXT NOT NULL,
    "requestedScopes" TEXT[],
    "approvedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessGrant" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshToken" TEXT,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "scopesReturned" TEXT[],
    "ip" TEXT,
    "userAgent" TEXT,
    "endpoint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerProfileShare" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "scope" JSONB NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BuyerProfileShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricePaidTransaction" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "postcode" TEXT NOT NULL,
    "propertyType" TEXT,
    "isNewBuild" BOOLEAN NOT NULL DEFAULT false,
    "tenure" TEXT,
    "paon" TEXT,
    "saon" TEXT,
    "street" TEXT,
    "locality" TEXT,
    "town" TEXT,
    "district" TEXT,
    "county" TEXT,
    "category" TEXT,

    CONSTRAINT "PricePaidTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "background" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceJob" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "locationLabel" TEXT NOT NULL,
    "postcode" TEXT,
    "distanceMi" DOUBLE PRECISION,
    "urgency" TEXT NOT NULL DEFAULT 'standard',
    "availability" TEXT,
    "availableDates" JSONB,
    "budgetMin" INTEGER NOT NULL,
    "budgetMax" INTEGER,
    "offerCount" INTEGER NOT NULL DEFAULT 0,
    "photoBg" TEXT,
    "photoBgs" JSONB,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'open',
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceOffer" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "availableDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceThread" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),

    CONSTRAINT "MarketplaceThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "MarketplaceMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT,
    "lastReadAt" TIMESTAMP(3),
    "mutedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readBy" JSONB,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actionUrl" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "push" JSONB NOT NULL,
    "email" JSONB NOT NULL,
    "inApp" JSONB NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ViewingRequest" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "proposedById" TEXT NOT NULL,
    "invitedUserId" TEXT NOT NULL,
    "conversationId" TEXT,
    "slots" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "chosenSlot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ViewingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplacePayment" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "platformFee" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "stripePaymentIntentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heldAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "evidencePhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "MarketplacePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceReview" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT,
    "punctuality" INTEGER,
    "communication" INTEGER,
    "workmanship" INTEGER,
    "reliability" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassportPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "stripePaymentIntentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeededAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "PassportPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlcSearch" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "searchAddress" TEXT,
    "extentGeoJson" JSONB,
    "extentAreaSqm" DOUBLE PRECISION,
    "warnings" TEXT[],
    "searchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlcSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlcCharge" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "boundary" BOOLEAN NOT NULL,
    "category" TEXT NOT NULL,
    "subCategory" TEXT,
    "law" TEXT,
    "legalDocument" TEXT,
    "description" TEXT,
    "location" TEXT,
    "reference" TEXT NOT NULL,
    "authorityReference" TEXT,
    "creationDate" TIMESTAMP(3),
    "registrationDate" TIMESTAMP(3),

    CONSTRAINT "LlcCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FounderNumber_passportId_key" ON "FounderNumber"("passportId");

-- CreateIndex
CREATE UNIQUE INDEX "FounderNumber_number_key" ON "FounderNumber"("number");

-- CreateIndex
CREATE INDEX "FounderNumber_userId_idx" ON "FounderNumber"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserInterest_userId_key" ON "UserInterest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE INDEX "PushToken_userId_idx" ON "PushToken"("userId");

-- CreateIndex
CREATE INDEX "CaptureEvent_type_createdAt_idx" ON "CaptureEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "CaptureEvent_userId_idx" ON "CaptureEvent"("userId");

-- CreateIndex
CREATE INDEX "CaptureEvent_propertyId_idx" ON "CaptureEvent"("propertyId");

-- CreateIndex
CREATE INDEX "CaptureEvent_postcode_idx" ON "CaptureEvent"("postcode");

-- CreateIndex
CREATE INDEX "UserAddress_userId_idx" ON "UserAddress"("userId");

-- CreateIndex
CREATE INDEX "UserCompany_userId_idx" ON "UserCompany"("userId");

-- CreateIndex
CREATE INDEX "UserSolicitor_userId_idx" ON "UserSolicitor"("userId");

-- CreateIndex
CREATE INDEX "UsedResetToken_expiresAt_idx" ON "UsedResetToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Property_udprn_key" ON "Property"("udprn");

-- CreateIndex
CREATE UNIQUE INDEX "Property_uprn_key" ON "Property"("uprn");

-- CreateIndex
CREATE INDEX "Property_postcode_idx" ON "Property"("postcode");

-- CreateIndex
CREATE INDEX "Property_uprn_idx" ON "Property"("uprn");

-- CreateIndex
CREATE INDEX "PropertySearchLog_propertyId_createdAt_idx" ON "PropertySearchLog"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "OwnershipVerification_propertyId_idx" ON "OwnershipVerification"("propertyId");

-- CreateIndex
CREATE INDEX "OwnershipVerification_userId_idx" ON "OwnershipVerification"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnershipVerification_propertyId_userId_key" ON "OwnershipVerification"("propertyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX "PassportCollection_userId_idx" ON "PassportCollection"("userId");

-- CreateIndex
CREATE INDEX "PassportCollectionItem_collectionId_idx" ON "PassportCollectionItem"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "PassportCollectionItem_collectionId_passportId_key" ON "PassportCollectionItem"("collectionId", "passportId");

-- CreateIndex
CREATE INDEX "PassportCollaboratorInvite_email_idx" ON "PassportCollaboratorInvite"("email");

-- CreateIndex
CREATE INDEX "PassportCollaboratorInvite_passportId_idx" ON "PassportCollaboratorInvite"("passportId");

-- CreateIndex
CREATE UNIQUE INDEX "PassportCollaboratorInvite_passportId_email_key" ON "PassportCollaboratorInvite"("passportId", "email");

-- CreateIndex
CREATE INDEX "UserCollaborator_userId_idx" ON "UserCollaborator"("userId");

-- CreateIndex
CREATE INDEX "UserCollaborator_collaboratorId_idx" ON "UserCollaborator"("collaboratorId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCollaborator_userId_collaboratorId_key" ON "UserCollaborator"("userId", "collaboratorId");

-- CreateIndex
CREATE INDEX "BuyerPassportAccess_passportId_idx" ON "BuyerPassportAccess"("passportId");

-- CreateIndex
CREATE INDEX "BuyerPassportAccess_userId_idx" ON "BuyerPassportAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerPassportAccess_passportId_userId_key" ON "BuyerPassportAccess"("passportId", "userId");

-- CreateIndex
CREATE INDEX "PassportActivity_passportId_createdAt_idx" ON "PassportActivity"("passportId", "createdAt");

-- CreateIndex
CREATE INDEX "PassportEvent_passportId_occurredAt_idx" ON "PassportEvent"("passportId", "occurredAt");

-- CreateIndex
CREATE INDEX "PassportEvent_passportId_eventType_idx" ON "PassportEvent"("passportId", "eventType");

-- CreateIndex
CREATE INDEX "PassportEvent_correlationId_idx" ON "PassportEvent"("correlationId");

-- CreateIndex
CREATE INDEX "PassportRule_enabled_idx" ON "PassportRule"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "PassportRule_ruleKey_version_key" ON "PassportRule"("ruleKey", "version");

-- CreateIndex
CREATE INDEX "PassportAction_passportId_status_idx" ON "PassportAction"("passportId", "status");

-- CreateIndex
CREATE INDEX "PassportAction_passportId_ruleId_subjectEntityId_idx" ON "PassportAction"("passportId", "ruleId", "subjectEntityId");

-- CreateIndex
CREATE INDEX "DocumentVersion_documentId_version_idx" ON "DocumentVersion"("documentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PointsLedgerEntry_passportQuestionId_key" ON "PointsLedgerEntry"("passportQuestionId");

-- CreateIndex
CREATE INDEX "PointsLedgerEntry_userId_createdAt_idx" ON "PointsLedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PointsLedgerEntry_passportId_idx" ON "PointsLedgerEntry"("passportId");

-- CreateIndex
CREATE INDEX "PointsLedgerEntry_propertyId_idx" ON "PointsLedgerEntry"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsLedgerEntry_userId_actionKey_subjectId_key" ON "PointsLedgerEntry"("userId", "actionKey", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardAction_actionKey_key" ON "RewardAction"("actionKey");

-- CreateIndex
CREATE UNIQUE INDEX "StampDefinition_key_key" ON "StampDefinition"("key");

-- CreateIndex
CREATE INDEX "UserStamp_userId_idx" ON "UserStamp"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserStamp_userId_stampDefinitionId_passportId_key" ON "UserStamp"("userId", "stampDefinitionId", "passportId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionSourceMapping_sourceParagraph_key" ON "QuestionSourceMapping"("sourceParagraph");

-- CreateIndex
CREATE INDEX "QuestionSourceMapping_liveQuestionTemplateId_idx" ON "QuestionSourceMapping"("liveQuestionTemplateId");

-- CreateIndex
CREATE INDEX "QuestionAnswerGuidance_sourceParagraph_idx" ON "QuestionAnswerGuidance"("sourceParagraph");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionAnswerGuidance_sourceParagraph_answerValue_key" ON "QuestionAnswerGuidance"("sourceParagraph", "answerValue");

-- CreateIndex
CREATE INDEX "PathwayQuestionLink_pathwayId_idx" ON "PathwayQuestionLink"("pathwayId");

-- CreateIndex
CREATE INDEX "PathwayJourney_passportId_idx" ON "PathwayJourney"("passportId");

-- CreateIndex
CREATE INDEX "PathwayJourney_passportId_pathwayId_idx" ON "PathwayJourney"("passportId", "pathwayId");

-- CreateIndex
CREATE INDEX "UserWishlist_userId_idx" ON "UserWishlist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserWishlist_userId_propertyId_key" ON "UserWishlist"("userId", "propertyId");

-- CreateIndex
CREATE INDEX "UserSavedProperty_userId_idx" ON "UserSavedProperty"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSavedProperty_userId_propertyId_key" ON "UserSavedProperty"("userId", "propertyId");

-- CreateIndex
CREATE INDEX "RecentlyViewedProperty_userId_viewedAt_idx" ON "RecentlyViewedProperty"("userId", "viewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecentlyViewedProperty_userId_propertyId_key" ON "RecentlyViewedProperty"("userId", "propertyId");

-- CreateIndex
CREATE INDEX "PropertyWatch_propertyId_idx" ON "PropertyWatch"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyWatch_userId_propertyId_key" ON "PropertyWatch"("userId", "propertyId");

-- CreateIndex
CREATE INDEX "UserReminder_userId_idx" ON "UserReminder"("userId");

-- CreateIndex
CREATE INDEX "UserReminder_userId_date_idx" ON "UserReminder"("userId", "date");

-- CreateIndex
CREATE INDEX "UserReminder_userId_sourceRef_idx" ON "UserReminder"("userId", "sourceRef");

-- CreateIndex
CREATE INDEX "UserDocument_userId_idx" ON "UserDocument"("userId");

-- CreateIndex
CREATE INDEX "UserDocument_passportId_idx" ON "UserDocument"("passportId");

-- CreateIndex
CREATE INDEX "DocumentAccessGrant_collaboratorUserId_idx" ON "DocumentAccessGrant"("collaboratorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAccessGrant_questionAnswerId_collaboratorUserId_key" ON "DocumentAccessGrant"("questionAnswerId", "collaboratorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAccessGrant_userDocumentId_collaboratorUserId_key" ON "DocumentAccessGrant"("userDocumentId", "collaboratorUserId");

-- CreateIndex
CREATE INDEX "ShareManifestDocument_sharedPassportLinkId_idx" ON "ShareManifestDocument"("sharedPassportLinkId");

-- CreateIndex
CREATE INDEX "ShareManifestDocument_buyerPassportAccessId_idx" ON "ShareManifestDocument"("buyerPassportAccessId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportRequest_ticketNumber_key" ON "SupportRequest"("ticketNumber");

-- CreateIndex
CREATE INDEX "VideoProgress_userId_idx" ON "VideoProgress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoProgress_userId_videoId_key" ON "VideoProgress"("userId", "videoId");

-- CreateIndex
CREATE INDEX "HomeScoreResult_propertyId_idx" ON "HomeScoreResult"("propertyId");

-- CreateIndex
CREATE INDEX "HomeScoreResult_userId_idx" ON "HomeScoreResult"("userId");

-- CreateIndex
CREATE INDEX "HomeScoreResult_publishedAt_idx" ON "HomeScoreResult"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HomeScoreResult_propertyId_userId_key" ON "HomeScoreResult"("propertyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyWork_propertyId_userId_workTypeCode_key" ON "PropertyWork"("propertyId", "userId", "workTypeCode");

-- CreateIndex
CREATE UNIQUE INDEX "ValuationSnapshot_propertyId_userId_key" ON "ValuationSnapshot"("propertyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TenancySignLink_token_key" ON "TenancySignLink"("token");

-- CreateIndex
CREATE INDEX "TenancySignLink_token_idx" ON "TenancySignLink"("token");

-- CreateIndex
CREATE INDEX "TenancySignLink_passportQuestionId_idx" ON "TenancySignLink"("passportQuestionId");

-- CreateIndex
CREATE UNIQUE INDEX "SharedPassportLink_token_key" ON "SharedPassportLink"("token");

-- CreateIndex
CREATE INDEX "SharedPassportLink_token_idx" ON "SharedPassportLink"("token");

-- CreateIndex
CREATE INDEX "SharedPassportLink_passportId_idx" ON "SharedPassportLink"("passportId");

-- CreateIndex
CREATE INDEX "BuyerNote_passportId_userId_idx" ON "BuyerNote"("passportId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerProfile_userId_key" ON "BuyerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerProfile_publicRef_key" ON "BuyerProfile"("publicRef");

-- CreateIndex
CREATE UNIQUE INDEX "VerifierClient_clientId_key" ON "VerifierClient"("clientId");

-- CreateIndex
CREATE INDEX "VerifierClient_orgId_idx" ON "VerifierClient"("orgId");

-- CreateIndex
CREATE INDEX "AccessRequest_buyerUserId_status_idx" ON "AccessRequest"("buyerUserId", "status");

-- CreateIndex
CREATE INDEX "AccessRequest_clientId_idx" ON "AccessRequest"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessGrant_requestId_key" ON "AccessGrant"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessGrant_accessTokenHash_key" ON "AccessGrant"("accessTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AccessGrant_refreshToken_key" ON "AccessGrant"("refreshToken");

-- CreateIndex
CREATE INDEX "AccessGrant_accessTokenHash_idx" ON "AccessGrant"("accessTokenHash");

-- CreateIndex
CREATE INDEX "AccessLog_grantId_idx" ON "AccessLog"("grantId");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerProfileShare_token_key" ON "BuyerProfileShare"("token");

-- CreateIndex
CREATE INDEX "BuyerProfileShare_profileId_idx" ON "BuyerProfileShare"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "PricePaidTransaction_transactionId_key" ON "PricePaidTransaction"("transactionId");

-- CreateIndex
CREATE INDEX "PricePaidTransaction_postcode_idx" ON "PricePaidTransaction"("postcode");

-- CreateIndex
CREATE INDEX "PricePaidTransaction_postcode_paon_idx" ON "PricePaidTransaction"("postcode", "paon");

-- CreateIndex
CREATE INDEX "PricePaidTransaction_transactionDate_idx" ON "PricePaidTransaction"("transactionDate");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceCategory_slug_key" ON "MarketplaceCategory"("slug");

-- CreateIndex
CREATE INDEX "MarketplaceJob_categoryId_idx" ON "MarketplaceJob"("categoryId");

-- CreateIndex
CREATE INDEX "MarketplaceJob_status_idx" ON "MarketplaceJob"("status");

-- CreateIndex
CREATE INDEX "MarketplaceJob_postcode_idx" ON "MarketplaceJob"("postcode");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_jobId_idx" ON "MarketplaceOffer"("jobId");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_supplierId_idx" ON "MarketplaceOffer"("supplierId");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_status_idx" ON "MarketplaceOffer"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceOffer_jobId_supplierId_key" ON "MarketplaceOffer"("jobId", "supplierId");

-- CreateIndex
CREATE INDEX "MarketplaceThread_customerId_idx" ON "MarketplaceThread"("customerId");

-- CreateIndex
CREATE INDEX "MarketplaceThread_supplierId_idx" ON "MarketplaceThread"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceThread_jobId_supplierId_key" ON "MarketplaceThread"("jobId", "supplierId");

-- CreateIndex
CREATE INDEX "MarketplaceMessage_threadId_idx" ON "MarketplaceMessage"("threadId");

-- CreateIndex
CREATE INDEX "Conversation_context_contextId_idx" ON "Conversation"("context", "contextId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_userId_idx" ON "ConversationParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationParticipant_conversationId_userId_key" ON "ConversationParticipant"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ViewingRequest_propertyId_idx" ON "ViewingRequest"("propertyId");

-- CreateIndex
CREATE INDEX "ViewingRequest_invitedUserId_idx" ON "ViewingRequest"("invitedUserId");

-- CreateIndex
CREATE INDEX "ViewingRequest_proposedById_idx" ON "ViewingRequest"("proposedById");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplacePayment_jobId_key" ON "MarketplacePayment"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplacePayment_offerId_key" ON "MarketplacePayment"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplacePayment_stripePaymentIntentId_key" ON "MarketplacePayment"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "MarketplacePayment_customerId_idx" ON "MarketplacePayment"("customerId");

-- CreateIndex
CREATE INDEX "MarketplacePayment_supplierId_idx" ON "MarketplacePayment"("supplierId");

-- CreateIndex
CREATE INDEX "MarketplacePayment_status_idx" ON "MarketplacePayment"("status");

-- CreateIndex
CREATE INDEX "MarketplaceReview_toUserId_idx" ON "MarketplaceReview"("toUserId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceReview_jobId_fromUserId_key" ON "MarketplaceReview"("jobId", "fromUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PassportPayment_stripePaymentIntentId_key" ON "PassportPayment"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "PassportPayment_userId_passportId_idx" ON "PassportPayment"("userId", "passportId");

-- CreateIndex
CREATE INDEX "PassportPayment_status_idx" ON "PassportPayment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LlcSearch_propertyId_key" ON "LlcSearch"("propertyId");

-- CreateIndex
CREATE INDEX "LlcSearch_status_idx" ON "LlcSearch"("status");

-- CreateIndex
CREATE INDEX "LlcSearch_searchedAt_idx" ON "LlcSearch"("searchedAt");

-- CreateIndex
CREATE INDEX "LlcCharge_searchId_idx" ON "LlcCharge"("searchId");

-- CreateIndex
CREATE INDEX "LlcCharge_category_subCategory_idx" ON "LlcCharge"("category", "subCategory");

-- CreateIndex
CREATE INDEX "Passport_propertyId_idx" ON "Passport"("propertyId");

-- CreateIndex
CREATE INDEX "Passport_type_idx" ON "Passport"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Passport_ownerId_propertyId_type_key" ON "Passport"("ownerId", "propertyId", "type");

-- CreateIndex
CREATE INDEX "SectionTemplate_type_idx" ON "SectionTemplate"("type");

-- AddForeignKey
ALTER TABLE "FounderNumber" ADD CONSTRAINT "FounderNumber_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FounderNumber" ADD CONSTRAINT "FounderNumber_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInterest" ADD CONSTRAINT "UserInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureEvent" ADD CONSTRAINT "CaptureEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureEvent" ADD CONSTRAINT "CaptureEvent_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAddress" ADD CONSTRAINT "UserAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCompany" ADD CONSTRAINT "UserCompany_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSolicitor" ADD CONSTRAINT "UserSolicitor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertySearchLog" ADD CONSTRAINT "PropertySearchLog_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipVerification" ADD CONSTRAINT "OwnershipVerification_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passport" ADD CONSTRAINT "Passport_convertedFromId_fkey" FOREIGN KEY ("convertedFromId") REFERENCES "Passport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passport" ADD CONSTRAINT "Passport_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassportCollection" ADD CONSTRAINT "PassportCollection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassportCollectionItem" ADD CONSTRAINT "PassportCollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "PassportCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassportCollectionItem" ADD CONSTRAINT "PassportCollectionItem_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassportCollaboratorInvite" ADD CONSTRAINT "PassportCollaboratorInvite_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCollaborator" ADD CONSTRAINT "UserCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCollaborator" ADD CONSTRAINT "UserCollaborator_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerPassportAccess" ADD CONSTRAINT "BuyerPassportAccess_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerPassportAccess" ADD CONSTRAINT "BuyerPassportAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassportActivity" ADD CONSTRAINT "PassportActivity_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassportEvent" ADD CONSTRAINT "PassportEvent_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassportAction" ADD CONSTRAINT "PassportAction_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassportAction" ADD CONSTRAINT "PassportAction_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "PassportRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedgerEntry" ADD CONSTRAINT "PointsLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStamp" ADD CONSTRAINT "UserStamp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStamp" ADD CONSTRAINT "UserStamp_stampDefinitionId_fkey" FOREIGN KEY ("stampDefinitionId") REFERENCES "StampDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSourceMapping" ADD CONSTRAINT "QuestionSourceMapping_liveQuestionTemplateId_fkey" FOREIGN KEY ("liveQuestionTemplateId") REFERENCES "QuestionTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PathwayQuestionLink" ADD CONSTRAINT "PathwayQuestionLink_pathwayId_fkey" FOREIGN KEY ("pathwayId") REFERENCES "ResolutionPathway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PathwayJourney" ADD CONSTRAINT "PathwayJourney_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PathwayJourney" ADD CONSTRAINT "PathwayJourney_pathwayId_fkey" FOREIGN KEY ("pathwayId") REFERENCES "ResolutionPathway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWishlist" ADD CONSTRAINT "UserWishlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWishlist" ADD CONSTRAINT "UserWishlist_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSavedProperty" ADD CONSTRAINT "UserSavedProperty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSavedProperty" ADD CONSTRAINT "UserSavedProperty_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentlyViewedProperty" ADD CONSTRAINT "RecentlyViewedProperty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentlyViewedProperty" ADD CONSTRAINT "RecentlyViewedProperty_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyWatch" ADD CONSTRAINT "PropertyWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyWatch" ADD CONSTRAINT "PropertyWatch_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReminder" ADD CONSTRAINT "UserReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDocument" ADD CONSTRAINT "UserDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDocument" ADD CONSTRAINT "UserDocument_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAccessGrant" ADD CONSTRAINT "DocumentAccessGrant_questionAnswerId_fkey" FOREIGN KEY ("questionAnswerId") REFERENCES "QuestionAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAccessGrant" ADD CONSTRAINT "DocumentAccessGrant_userDocumentId_fkey" FOREIGN KEY ("userDocumentId") REFERENCES "UserDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAccessGrant" ADD CONSTRAINT "DocumentAccessGrant_collaboratorUserId_fkey" FOREIGN KEY ("collaboratorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareManifestDocument" ADD CONSTRAINT "ShareManifestDocument_sharedPassportLinkId_fkey" FOREIGN KEY ("sharedPassportLinkId") REFERENCES "SharedPassportLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareManifestDocument" ADD CONSTRAINT "ShareManifestDocument_buyerPassportAccessId_fkey" FOREIGN KEY ("buyerPassportAccessId") REFERENCES "BuyerPassportAccess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareManifestDocument" ADD CONSTRAINT "ShareManifestDocument_questionAnswerId_fkey" FOREIGN KEY ("questionAnswerId") REFERENCES "QuestionAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareManifestDocument" ADD CONSTRAINT "ShareManifestDocument_userDocumentId_fkey" FOREIGN KEY ("userDocumentId") REFERENCES "UserDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProgress" ADD CONSTRAINT "VideoProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProgress" ADD CONSTRAINT "VideoProgress_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyWork" ADD CONSTRAINT "PropertyWork_workTypeCode_fkey" FOREIGN KEY ("workTypeCode") REFERENCES "WorkType"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenancySignLink" ADD CONSTRAINT "TenancySignLink_passportQuestionId_fkey" FOREIGN KEY ("passportQuestionId") REFERENCES "PassportQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedPassportLink" ADD CONSTRAINT "SharedPassportLink_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerNote" ADD CONSTRAINT "BuyerNote_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerNote" ADD CONSTRAINT "BuyerNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerProfile" ADD CONSTRAINT "BuyerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifierClient" ADD CONSTRAINT "VerifierClient_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "VerifierOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "VerifierOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "VerifierClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AccessRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "AccessGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerProfileShare" ADD CONSTRAINT "BuyerProfileShare_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BuyerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceJob" ADD CONSTRAINT "MarketplaceJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceJob" ADD CONSTRAINT "MarketplaceJob_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MarketplaceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceOffer" ADD CONSTRAINT "MarketplaceOffer_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MarketplaceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceOffer" ADD CONSTRAINT "MarketplaceOffer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceThread" ADD CONSTRAINT "MarketplaceThread_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MarketplaceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceThread" ADD CONSTRAINT "MarketplaceThread_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceThread" ADD CONSTRAINT "MarketplaceThread_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceMessage" ADD CONSTRAINT "MarketplaceMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MarketplaceThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceMessage" ADD CONSTRAINT "MarketplaceMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingRequest" ADD CONSTRAINT "ViewingRequest_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingRequest" ADD CONSTRAINT "ViewingRequest_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingRequest" ADD CONSTRAINT "ViewingRequest_invitedUserId_fkey" FOREIGN KEY ("invitedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingRequest" ADD CONSTRAINT "ViewingRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplacePayment" ADD CONSTRAINT "MarketplacePayment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MarketplaceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplacePayment" ADD CONSTRAINT "MarketplacePayment_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "MarketplaceOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplacePayment" ADD CONSTRAINT "MarketplacePayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplacePayment" ADD CONSTRAINT "MarketplacePayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceReview" ADD CONSTRAINT "MarketplaceReview_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MarketplaceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceReview" ADD CONSTRAINT "MarketplaceReview_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceReview" ADD CONSTRAINT "MarketplaceReview_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassportPayment" ADD CONSTRAINT "PassportPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassportPayment" ADD CONSTRAINT "PassportPayment_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "Passport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlcSearch" ADD CONSTRAINT "LlcSearch_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlcCharge" ADD CONSTRAINT "LlcCharge_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "LlcSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

