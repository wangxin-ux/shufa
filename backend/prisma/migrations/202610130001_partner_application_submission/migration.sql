CREATE TABLE "PartnerApplicationSubmission" (
  "id" UUID PRIMARY KEY,
  "applicationId" UUID NOT NULL REFERENCES "PartnerApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "applicationVersion" INTEGER NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "institutionName" VARCHAR(200) NOT NULL,
  "province" VARCHAR(100) NOT NULL, "city" VARCHAR(100) NOT NULL, "district" VARCHAR(100) NOT NULL,
  "detailedAddress" VARCHAR(300) NOT NULL, "contactPhone" VARCHAR(30) NOT NULL,
  "regionCatalogVersion" VARCHAR(100) NOT NULL,
  "bankRecordId" UUID NOT NULL REFERENCES "PartnerApplicationBankRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "materialRecordId" UUID NOT NULL REFERENCES "PartnerApplicationMaterialRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerApplicationSubmission_version_check" CHECK ("sourceVersion" >= 1 AND "sourceVersion" < 2147483647 AND "applicationVersion" = "sourceVersion" + 1),
  CONSTRAINT "PartnerApplicationSubmission_applicationId_applicationVersion_key" UNIQUE ("applicationId", "applicationVersion"),
  CONSTRAINT "PartnerApplicationSubmission_applicationId_sourceVersion_key" UNIQUE ("applicationId", "sourceVersion")
);

CREATE FUNCTION partner_application_submission_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Partner application submissions are immutable';
END;
$$;
CREATE TRIGGER "PartnerApplicationSubmission_immutable"
BEFORE UPDATE OR DELETE ON "PartnerApplicationSubmission"
FOR EACH ROW EXECUTE FUNCTION partner_application_submission_immutable();
