import { capture, flush } from './operator-page-host';
export { flush };

// Reuse the existing host unchanged; the new Page is not registered in app.json here.
export function captureEarnings(driver: 'api' | 'mock' = 'api') {
  const env = capture(['earnings' as never, 'lesson-account'], driver);
  return {
    ...env,
    earningPage: () => env.instantiate('earnings' as never),
    accountPage: () => env.instantiate('lesson-account'),
  };
}
