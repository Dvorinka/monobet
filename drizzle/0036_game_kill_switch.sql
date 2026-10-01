-- Per-game kill switch for the admin panel — stakeGame rejects new stakes
-- for any canonical key listed here; in-flight rounds still settle.
ALTER TABLE "casino_config" ADD COLUMN "disabled_games" text[] NOT NULL DEFAULT '{}';
