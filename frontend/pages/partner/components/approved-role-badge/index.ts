import { getPartnerApplicationRuntime } from '../../runtime/partner-application-runtime';

type Runtime = ReturnType<typeof getPartnerApplicationRuntime>;
type BadgeState = {
  hidden: boolean;
  detached: boolean;
  sequence: number;
  timer?: ReturnType<typeof setInterval>;
  pending?: { runtime: Runtime; key: string; promise: Promise<void> };
};
const states = new WeakMap<object, BadgeState>();
function state(instance: object): BadgeState {
  let value = states.get(instance);
  if (!value) {
    value = { hidden: true, detached: false, sequence: 0 };
    states.set(instance, value);
  }
  return value;
}

Component({
  properties: {
    blocked: {
      type: Boolean,
      value: false,
      observer(blocked: boolean) {
        if (blocked) this.clearApproval();
        else void this.refreshApproval();
      },
    },
  },
  data: { approved: false, topPx: 32, rightPx: 100 },
  lifetimes: {
    attached() {
      const current = state(this);
      current.hidden = false;
      current.detached = false;
      this.updateBadgeLayout();
      void this.refreshApproval();
    },
    detached() {
      const current = state(this);
      current.detached = true;
      current.hidden = true;
      current.sequence += 1;
      current.pending = undefined;
      this.stopIdentityWatch();
    },
  },
  pageLifetimes: {
    show() {
      const current = state(this);
      if (current.detached) return;
      current.hidden = false;
      this.updateBadgeLayout();
      void this.refreshApproval();
    },
    hide() {
      const current = state(this);
      current.hidden = true;
      this.clearApproval();
    },
    resize() { this.updateBadgeLayout(); },
  },
  methods: {
    stopIdentityWatch() {
      const current = state(this);
      if (current.timer !== undefined) clearInterval(current.timer);
      current.timer = undefined;
    },
    clearApproval() {
      const current = state(this);
      current.sequence += 1;
      current.pending = undefined;
      this.stopIdentityWatch();
      if (!current.detached) this.setData({ approved: false });
    },
    watchIdentity(runtime: Runtime, key: string) {
      this.stopIdentityWatch();
      const current = state(this);
      const sequence = current.sequence;
      // Local credential changes have no native event; never poll the API here.
      current.timer = setInterval(() => {
        if (current.sequence !== sequence) return;
        if (current.hidden || current.detached) { this.stopIdentityWatch(); return; }
        try {
          if (this.data.blocked || getPartnerApplicationRuntime() !== runtime ||
              runtime.sessions.getSessionKey() !== key) this.clearApproval();
        } catch { this.clearApproval(); }
      }, 500);
    },
    updateBadgeLayout() {
      const current = state(this);
      if (current.hidden || current.detached) return;
      let topPx = 32;
      let rightPx = 100;
      try {
        const info = wx.getWindowInfo();
        topPx = (info.statusBarHeight ?? 24) + 8;
        const capsule = wx.getMenuButtonBoundingClientRect();
        if (capsule.height > 0) {
          topPx = Math.max(info.statusBarHeight ?? 0, capsule.top);
          rightPx = Math.max(16, info.windowWidth - capsule.left + 8);
        }
      } catch { /* Keep the header fallback without covering the native capsule. */ }
      this.setData({ topPx, rightPx });
    },
    refreshApproval(): Promise<void> {
      const current = state(this);
      if (current.hidden || current.detached || this.data.blocked) return Promise.resolve();
      this.stopIdentityWatch();
      this.setData({ approved: false });
      let runtime: Runtime;
      let key: string;
      try {
        runtime = getPartnerApplicationRuntime();
        key = runtime.formalArchive ? runtime.sessions.getSessionKey() : '';
        if (!key) {
          current.sequence += 1;
          current.pending = undefined;
          return Promise.resolve();
        }
      } catch {
        current.sequence += 1;
        current.pending = undefined;
        return Promise.resolve();
      }
      if (current.pending?.runtime === runtime && current.pending.key === key) {
        return current.pending.promise;
      }
      const sequence = ++current.sequence;
      const active = () => {
        if (current.hidden || current.detached || this.data.blocked || current.sequence !== sequence) return false;
        try {
          return getPartnerApplicationRuntime() === runtime &&
            runtime.sessions.getSessionKey() === key;
        } catch { return false; }
      };
      const promise = Promise.resolve().then(async () => {
        if (active()) return await runtime.sessions.loadMe({ fresh: true });
      }).then((identity) => {
        if (identity && active()) {
          const approved = identity.formalAccountReady === true;
          this.setData({ approved });
          if (approved) this.watchIdentity(runtime, key);
        }
      }).catch(() => {
        if (active()) this.setData({ approved: false });
      }).finally(() => {
        if (current.pending?.promise === promise) current.pending = undefined;
      });
      current.pending = { runtime, key, promise };
      return promise;
    },
  },
});
