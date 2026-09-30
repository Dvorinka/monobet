ALTER TABLE "challenge" ADD COLUMN "kind" text NOT NULL DEFAULT 'claim';
ALTER TABLE "challenge" ADD COLUMN "state" jsonb;
