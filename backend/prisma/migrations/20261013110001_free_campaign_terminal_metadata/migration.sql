-- PostgreSQL CHECK accepts UNKNOWN, so terminal nullable fields need explicit presence.
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_close_reason_present"
  CHECK ("lifecycle" <> 'CLOSED' OR "closeReason" IS NOT NULL);
ALTER TABLE "CampaignRegistration" ADD CONSTRAINT "CampaignRegistration_canceller_present"
  CHECK ("status" <> 'CANCELLED' OR "cancelledByUserId" IS NOT NULL);
