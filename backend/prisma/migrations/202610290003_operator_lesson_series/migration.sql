CREATE TABLE "LessonSeries" (
  "id" UUID NOT NULL,
  "campusId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "configuration" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LessonSeries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LessonSeries_version_check" CHECK ("version" > 0),
  CONSTRAINT "LessonSeries_campusId_fkey" FOREIGN KEY ("campusId")
    REFERENCES "Campus" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonSeries_createdByUserId_fkey" FOREIGN KEY ("createdByUserId")
    REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LessonSeries_id_campusId_key" ON "LessonSeries" ("id", "campusId");
CREATE INDEX "LessonSeries_campusId_createdAt_idx" ON "LessonSeries" ("campusId", "createdAt");
ALTER TABLE "LessonSession" ADD COLUMN "seriesId" UUID;
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_seriesId_campusId_fkey"
  FOREIGN KEY ("seriesId", "campusId") REFERENCES "LessonSeries" ("id", "campusId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "LessonSession_seriesId_startsAt_idx" ON "LessonSession" ("seriesId", "startsAt");
