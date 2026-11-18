export class NativeCampaignActivity {
  private readonly jobs = new Set<symbol>();
  get size() {
    return this.jobs.size;
  }
  begin(): () => void {
    const job = Symbol();
    this.jobs.add(job);
    return () => {
      this.jobs.delete(job);
    };
  }
  async idle(timeoutMilliseconds = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMilliseconds;
    let idleTurns = 0;
    while (idleTurns < 2) {
      if (Date.now() >= deadline)
        throw new Error('Fixture requests did not drain');
      await new Promise<void>((resolve) => setImmediate(resolve));
      idleTurns = this.size === 0 ? idleTurns + 1 : 0;
      if (this.size) await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  observeResponse(response: {
    once(event: 'finish' | 'close', callback: () => void): unknown;
  }) {
    const end = this.begin();
    response.once('finish', end);
    response.once('close', end);
  }
  async during<T>(work: () => Promise<T>): Promise<T> {
    const end = this.begin();
    try {
      return await work();
    } finally {
      end();
    }
  }
}
