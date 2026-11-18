export const PARTNER_APPLICATION_REGION_CATALOG =
  'PARTNER_APPLICATION_REGION_CATALOG';

export interface PartnerApplicationRegionCatalog {
  readonly version: string;
  matches(province: string, city: string, district: string): boolean;
}

// Formal catalog ingestion is pending; nonempty text is never a valid hierarchy by itself.
export const unavailableRegionCatalog: PartnerApplicationRegionCatalog = {
  version: '',
  matches: () => false,
};
