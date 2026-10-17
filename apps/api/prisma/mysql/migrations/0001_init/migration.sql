-- CreateTable
CREATE TABLE `StudyArea` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `originLat` DOUBLE NOT NULL,
    `originLng` DOUBLE NOT NULL,
    `rows` INTEGER NOT NULL,
    `columns` INTEGER NOT NULL,
    `cellSizeLat` DOUBLE NOT NULL,
    `cellSizeLng` DOUBLE NOT NULL,
    `rotation` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Cell` (
    `id` VARCHAR(191) NOT NULL,
    `studyAreaId` VARCHAR(191) NOT NULL,
    `row` INTEGER NOT NULL,
    `col` INTEGER NOT NULL,
    `centerLat` DOUBLE NOT NULL,
    `centerLng` DOUBLE NOT NULL,
    `polygonJson` TEXT NOT NULL,
    `areaName` VARCHAR(120) NOT NULL,
    `landUse` VARCHAR(40) NOT NULL,
    `surfaceType` VARCHAR(40) NOT NULL,
    `heat` DOUBLE NOT NULL,
    `vegetation` DOUBLE NOT NULL,
    `pedestrian` DOUBLE NOT NULL,
    `connectivity` DOUBLE NOT NULL,
    `feasibility` DOUBLE NOT NULL,
    `existingGreenCover` DOUBLE NOT NULL,
    `priorityZone` BOOLEAN NOT NULL DEFAULT false,
    `dataConfidence` DOUBLE NOT NULL,
    `capacity` INTEGER NOT NULL,

    INDEX `Cell_studyAreaId_areaName_idx`(`studyAreaId`, `areaName`),
    UNIQUE INDEX `Cell_studyAreaId_row_col_key`(`studyAreaId`, `row`, `col`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Scenario` (
    `id` VARCHAR(191) NOT NULL,
    `studyAreaId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(600) NULL,
    `budget` DOUBLE NOT NULL,
    `weightsJson` VARCHAR(512) NOT NULL,
    `planJson` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Scenario_studyAreaId_createdAt_idx`(`studyAreaId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `role` VARCHAR(20) NOT NULL DEFAULT 'viewer',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefreshSession` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(128) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RefreshSession_tokenHash_key`(`tokenHash`),
    INDEX `RefreshSession_userId_expiresAt_idx`(`userId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Cell` ADD CONSTRAINT `Cell_studyAreaId_fkey` FOREIGN KEY (`studyAreaId`) REFERENCES `StudyArea`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Scenario` ADD CONSTRAINT `Scenario_studyAreaId_fkey` FOREIGN KEY (`studyAreaId`) REFERENCES `StudyArea`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RefreshSession` ADD CONSTRAINT `RefreshSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
