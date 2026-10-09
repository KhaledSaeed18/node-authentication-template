-- Emails are now normalized to lowercase by the API. Bring existing rows in line.
-- This fails on purpose if two accounts only differ by case, so they can be merged by hand.
UPDATE "User" SET "email" = lower("email") WHERE "email" <> lower("email");
