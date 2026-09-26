ALTER TABLE "users"
ADD COLUMN "is_onboarded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "location" TEXT,
ADD COLUMN "occupation" TEXT;