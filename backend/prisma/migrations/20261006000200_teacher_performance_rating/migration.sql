ALTER TABLE "StudentFeedback" ADD COLUMN "performanceRating" INTEGER;
ALTER TABLE "StudentFeedback" ADD CONSTRAINT "StudentFeedback_performanceRating_check"
  CHECK ("performanceRating" IS NULL OR "performanceRating" BETWEEN 1 AND 10);
