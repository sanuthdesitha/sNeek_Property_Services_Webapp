-- Social post generator (2026-11-17), follow-up: the shape every photo of a
-- composed post is cropped to. Additive with a default.
ALTER TABLE "SocialPostGroup" ADD COLUMN "ratio" TEXT NOT NULL DEFAULT '4:5';
