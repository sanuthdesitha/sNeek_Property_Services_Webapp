-- Combined-quiz support: snapshot a merged schema + display title on the assignment.
ALTER TABLE "QuizAssignment"
  ADD COLUMN "schema" JSONB,
  ADD COLUMN "title" TEXT;
