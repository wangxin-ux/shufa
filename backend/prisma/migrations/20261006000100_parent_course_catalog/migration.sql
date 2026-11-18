ALTER TABLE "CourseProduct"
  ADD COLUMN "courseName" VARCHAR(200),
  ADD COLUMN "classType" VARCHAR(50);

UPDATE "CourseProduct"
SET "courseName" = "name", "classType" = '常规班';

CREATE INDEX "CourseProduct_status_courseName_idx" ON "CourseProduct"("status", "courseName");
