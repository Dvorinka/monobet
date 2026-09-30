-- Scheduled open: trades are rejected until opens_at; recurring clones shift
-- it forward by recur_days together with closes_at (Mon open → next Mon).
alter table "market" add column if not exists "opens_at" timestamptz;
