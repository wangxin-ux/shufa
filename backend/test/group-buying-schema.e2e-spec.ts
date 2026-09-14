import * as fs from 'node:fs';
import * as path from 'node:path';

describe('group buying Prisma schema', () => {
  const schema = fs.readFileSync(
    path.resolve(__dirname, '../prisma/schema.prisma'),
    'utf8',
  );

  it.each([
    'GroupCampaign',
    'GroupCampaignPoster',
    'GroupTeam',
    'GroupMember',
    'PaymentTransaction',
  ])('declares model %s', (model) => {
    expect(schema).toContain(`model ${model} {`);
  });

  it('keeps one effective member per student and campaign', () => {
    expect(schema).toContain('@@unique([campaignId, studentId])');
  });

  it('makes provider transaction numbers idempotent', () => {
    expect(schema).toContain(
      '@@unique([provider, providerTradeNo])',
    );
    expect(schema).toMatch(/outTradeNo\s+String\s+@unique/);
  });

  it('adds payment and refund states without removing the manual order flow', () => {
    for (const status of [
      'AWAITING_PROOF',
      'AWAITING_PAYMENT',
      'PENDING_REVIEW',
      'PAID',
      'EFFECTIVE',
      'REFUNDING',
      'REFUNDED',
    ]) {
      expect(schema).toMatch(
        new RegExp(`enum EnrollmentOrderStatus \\{[\\s\\S]*?\\b${status}\\b`),
      );
    }
  });

  it('keeps course package source orders unique', () => {
    expect(schema).toMatch(/sourceOrderId\s+String\?\s+@unique/);
  });

  it('keeps campaign poster ordering unique and files single-use', () => {
    expect(schema).toMatch(
      /enum StoredFilePurpose \{[\s\S]*?\bGROUP_CAMPAIGN_POSTER\b/,
    );
    expect(schema).toContain('@@unique([campaignId, sortOrder])');
    expect(schema).toMatch(/storedFileId\s+String\s+@unique/);
  });
});
