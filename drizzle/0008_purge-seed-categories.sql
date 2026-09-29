-- Categories are fully user-created now; drop the built-in seed rows from
-- 0004_categories so the table starts empty.
DELETE FROM "category";