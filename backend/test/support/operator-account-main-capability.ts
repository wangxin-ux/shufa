import { resolve } from 'node:path';
let held: { root: string; verify(): void } | undefined;
export function bindMainAccountAdmission(root: string, verify: () => void) {
  if (held) throw new Error('Account main capability already bound');
  const capability = { root: resolve(root), verify };
  verify();
  held = capability;
  return () => {
    if (held !== capability)
      throw new Error('Account capability ownership changed');
    held = undefined;
  };
}
export function checkMainAccountAdmission(root: string): boolean {
  if (!held || held.root !== resolve(root)) return false;
  held.verify();
  return true;
}
