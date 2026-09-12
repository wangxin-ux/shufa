ALTER TABLE "Campus"
  ADD COLUMN "latitude" DECIMAL(10,7),
  ADD COLUMN "longitude" DECIMAL(10,7),
  ADD COLUMN "mapVisible" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Campus"
  ADD CONSTRAINT "Campus_latitude_range_check"
    CHECK ("latitude" IS NULL OR ("latitude" >= -90 AND "latitude" <= 90)),
  ADD CONSTRAINT "Campus_longitude_range_check"
    CHECK ("longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180)),
  ADD CONSTRAINT "Campus_map_visible_location_check"
    CHECK (
      NOT "mapVisible" OR (
        "latitude" IS NOT NULL
        AND "longitude" IS NOT NULL
        AND "address" IS NOT NULL
        AND btrim("address") <> ''
      )
    );

CREATE INDEX "Campus_mapVisible_name_idx" ON "Campus"("mapVisible", "name");
