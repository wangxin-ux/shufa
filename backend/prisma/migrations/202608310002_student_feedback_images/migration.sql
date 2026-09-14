ALTER TYPE "StoredFilePurpose" ADD VALUE 'STUDENT_FEEDBACK_IMAGE';

CREATE TABLE "StudentFeedbackImage" (
    "id" UUID NOT NULL,
    "feedbackId" UUID NOT NULL,
    "storedFileId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentFeedbackImage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StudentFeedbackImage_sort_order_valid" CHECK ("sortOrder" BETWEEN 0 AND 2)
);

CREATE UNIQUE INDEX "StudentFeedbackImage_storedFileId_key" ON "StudentFeedbackImage"("storedFileId");
CREATE UNIQUE INDEX "StudentFeedbackImage_feedbackId_sortOrder_key" ON "StudentFeedbackImage"("feedbackId", "sortOrder");
CREATE INDEX "StudentFeedbackImage_feedbackId_idx" ON "StudentFeedbackImage"("feedbackId");

ALTER TABLE "StudentFeedbackImage" ADD CONSTRAINT "StudentFeedbackImage_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "StudentFeedback"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentFeedbackImage" ADD CONSTRAINT "StudentFeedbackImage_storedFileId_fkey" FOREIGN KEY ("storedFileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
