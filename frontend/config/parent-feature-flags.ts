export interface ParentFeatureFlags {
  showGiftHours: boolean;
}

// 家长需要核对主课时与赠送课时的组成，默认同时展示。
export const DEFAULT_PARENT_FEATURE_FLAGS: Readonly<ParentFeatureFlags> = Object.freeze({
  showGiftHours: true,
});

export function createParentFeatureFlags(
  overrides: Partial<ParentFeatureFlags> = {},
): ParentFeatureFlags {
  return {
    showGiftHours: overrides.showGiftHours ?? DEFAULT_PARENT_FEATURE_FLAGS.showGiftHours,
  };
}
