import { RequestState } from '../utils/request-state';

export type ParentPageSnapshot<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'empty'; data: T }
  | { status: 'error'; message: string };

function toPageSnapshot<T>(state: RequestState<T>): ParentPageSnapshot<T> {
  if (state.status === 'success') {
    return { status: 'ready', data: state.data };
  }
  if (state.status === 'empty') {
    return { status: 'empty', data: state.data };
  }
  if (state.status === 'error') {
    return { status: 'error', message: state.message };
  }
  return { status: 'loading' };
}

export class ParentPageLoader<T> {
  private currentSnapshot: ParentPageSnapshot<T> = { status: 'loading' };
  private inFlight: Promise<ParentPageSnapshot<T>> | null = null;

  constructor(private readonly request: () => Promise<RequestState<T>>) {}

  get snapshot(): ParentPageSnapshot<T> {
    return this.currentSnapshot;
  }

  load(): Promise<ParentPageSnapshot<T>> {
    if (this.inFlight) {
      return this.inFlight;
    }

    this.currentSnapshot = { status: 'loading' };
    const operation = this.execute();
    this.inFlight = operation;
    void operation.finally(() => {
      if (this.inFlight === operation) {
        this.inFlight = null;
      }
    });
    return operation;
  }

  retry(): Promise<ParentPageSnapshot<T>> {
    return this.load();
  }

  private async execute(): Promise<ParentPageSnapshot<T>> {
    const state = await this.request();
    const snapshot = toPageSnapshot(state);
    this.currentSnapshot = snapshot;
    return snapshot;
  }
}
