-- Add the selected interventions to persisted scenarios without breaking existing rows.
ALTER TABLE "Scenario" ADD COLUMN "enabledInterventionsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Scenario" ALTER COLUMN "enabledInterventionsJson" DROP DEFAULT;
