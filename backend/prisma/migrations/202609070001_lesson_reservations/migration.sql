ALTER TABLE "CoursePackage"
  ADD COLUMN "mainReservedUnits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "giftReservedUnits" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CoursePackage"
  ADD CONSTRAINT "CoursePackage_main_reserved_bounds"
    CHECK ("mainReservedUnits" >= 0 AND "mainReservedUnits" <= "mainBalanceUnits"),
  ADD CONSTRAINT "CoursePackage_gift_reserved_bounds"
    CHECK ("giftReservedUnits" >= 0 AND "giftReservedUnits" <= "giftBalanceUnits");
