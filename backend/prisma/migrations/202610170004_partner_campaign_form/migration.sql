ALTER TABLE "PartnerCampaignDraft"
ADD COLUMN "registrationForm" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "PartnerCampaignDraft"
ADD CONSTRAINT "PartnerCampaignDraft_registrationForm_array_check"
CHECK (CASE WHEN jsonb_typeof("registrationForm") = 'array'
  THEN jsonb_array_length("registrationForm") <= 20 ELSE false END);
