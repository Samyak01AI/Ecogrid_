-- CreateTable
CREATE TABLE "StudyArea" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "originLat" DOUBLE PRECISION NOT NULL,
    "originLng" DOUBLE PRECISION NOT NULL,
    "rows" INTEGER NOT NULL,
    "columns" INTEGER NOT NULL,
    "cellSizeLat" DOUBLE PRECISION NOT NULL,
    "cellSizeLng" DOUBLE PRECISION NOT NULL,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cell" (
    "id" TEXT NOT NULL,
    "studyAreaId" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "col" INTEGER NOT NULL,
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLng" DOUBLE PRECISION NOT NULL,
    "polygonJson" TEXT NOT NULL,
    "areaName" VARCHAR(120) NOT NULL,
    "landUse" VARCHAR(40) NOT NULL,
    "surfaceType" VARCHAR(40) NOT NULL,
    "heat" DOUBLE PRECISION NOT NULL,
    "vegetation" DOUBLE PRECISION NOT NULL,
    "pedestrian" DOUBLE PRECISION NOT NULL,
    "connectivity" DOUBLE PRECISION NOT NULL,
    "feasibility" DOUBLE PRECISION NOT NULL,
    "existingGreenCover" DOUBLE PRECISION NOT NULL,
    "priorityZone" BOOLEAN NOT NULL DEFAULT false,
    "dataConfidence" DOUBLE PRECISION NOT NULL,
    "capacity" INTEGER NOT NULL,

    CONSTRAINT "Cell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "studyAreaId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(600),
    "budget" DOUBLE PRECISION NOT NULL,
    "weightsJson" VARCHAR(512) NOT NULL,
    "planJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cell_studyAreaId_areaName_idx" ON "Cell"("studyAreaId", "areaName");

-- CreateIndex
CREATE UNIQUE INDEX "Cell_studyAreaId_row_col_key" ON "Cell"("studyAreaId", "row", "col");

-- CreateIndex
CREATE INDEX "Scenario_studyAreaId_createdAt_idx" ON "Scenario"("studyAreaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_expiresAt_idx" ON "RefreshSession"("userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "Cell" ADD CONSTRAINT "Cell_studyAreaId_fkey" FOREIGN KEY ("studyAreaId") REFERENCES "StudyArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_studyAreaId_fkey" FOREIGN KEY ("studyAreaId") REFERENCES "StudyArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
