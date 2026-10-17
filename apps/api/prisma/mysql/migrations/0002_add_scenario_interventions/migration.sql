-- Add the selected interventions to persisted scenarios without breaking existing rows.
ALTER TABLE `Scenario` ADD COLUMN `enabledInterventionsJson` TEXT NULL;
UPDATE `Scenario` SET `enabledInterventionsJson` = '[]' WHERE `enabledInterventionsJson` IS NULL;
ALTER TABLE `Scenario` MODIFY COLUMN `enabledInterventionsJson` TEXT NOT NULL;
