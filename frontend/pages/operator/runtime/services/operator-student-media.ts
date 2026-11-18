export interface OperatorStudentMediaFile {
  id: string;
  mimeType: string;
  sizeBytes: number;
  accessUrl: string;
}

interface DownloadOptions {
  url: string;
  header: Record<string, string>;
  timeout: number;
  success(value: { statusCode: number; tempFilePath: string }): void;
  fail(value: unknown): void;
}
interface ReaderOptions {
  apiBaseUrl: string;
  studentId: string;
  accessToken(): string;
  isCurrent(): boolean;
  download?: (options: DownloadOptions) => { abort(): void } | undefined;
}
interface PendingRead {
  promise: Promise<string>;
  task?: { abort(): void };
  finish(error?: StudentMediaError, localPath?: string): void;
}

class StudentMediaError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}
const cancelled = () => new StudentMediaError(0, '图片读取已中断，请重试');
const failed = () => new StudentMediaError(0, '图片读取失败，请重试');
const httpError = (status: number) => new StudentMediaError(status,
  status === 401 ? '登录已失效，请重新登录'
    : status === 403 ? '当前账号无权查看该图片'
    : status === 404 ? '图片已不可用，请重新读取'
    : '图片读取失败，请重试');

export class OperatorStudentMediaReader {
  private readonly root: string;
  private readonly relativeRoot: string;
  private readonly pending = new Map<string, PendingRead>();
  private generation = 0;

  constructor(private readonly options: ReaderOptions) {
    this.root = options.apiBaseUrl.replace(/\/+$/, '');
    this.relativeRoot = `/operators/me/students/${encodeURIComponent(options.studentId)}/archive/media`;
    if (!options.studentId || !/^https?:\/\/[^?#]+$/.test(this.root)) {
      throw new Error('图片读取地址不可用');
    }
  }

  load(file: OperatorStudentMediaFile): Promise<string> {
    if (!file.id || file.accessUrl !== `${this.relativeRoot}/${encodeURIComponent(file.id)}` ||
      !['image/jpeg', 'image/png'].includes(file.mimeType) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0) {
      return Promise.reject(new StudentMediaError(400, '图片读取地址不可用'));
    }
    const active = this.pending.get(file.id);
    if (active) return active.promise;
    let resolve!: (value: string) => void;
    let reject!: (error: StudentMediaError) => void;
    const promise = new Promise<string>((accept, decline) => { resolve = accept; reject = decline; });
    const generation = this.generation;
    let finished = false;
    const pending: PendingRead = {
      promise,
      finish: (error, localPath) => {
        if (finished) return;
        finished = true;
        if (this.pending.get(file.id) === pending) this.pending.delete(file.id);
        if (error) reject(error);
        else resolve(localPath!);
      },
    };
    this.pending.set(file.id, pending);
    const current = () => generation === this.generation && this.options.isCurrent();
    void Promise.resolve().then(() => {
      if (!current()) return pending.finish(cancelled());
      const token = this.options.accessToken().trim();
      if (!token) return pending.finish(httpError(401));
      const download = this.options.download ?? ((options: DownloadOptions) => wx.downloadFile(options));
      try {
        pending.task = download({
          url: `${this.root}${file.accessUrl}`, header: { Authorization: `Bearer ${token}` }, timeout: 15000,
          success: (result) => {
            if (!current()) return pending.finish(cancelled());
            if (result.statusCode !== 200) return pending.finish(httpError(result.statusCode));
            if (!result.tempFilePath?.trim()) return pending.finish(failed());
            pending.finish(undefined, result.tempFilePath);
          },
          fail: () => pending.finish(current() ? failed() : cancelled()),
        });
      } catch {
        pending.finish(current() ? failed() : cancelled());
      }
    }).catch(() => pending.finish(failed()));
    return promise;
  }

  invalidate(): void {
    this.generation += 1;
    this.retain(new Set());
  }

  retain(fileIds: ReadonlySet<string>): void {
    for (const [id, pending] of [...this.pending.entries()]) {
      if (fileIds.has(id)) continue;
      pending.finish(cancelled());
      try { pending.task?.abort(); } catch { /* A settled native task may already be closed. */ }
    }
  }
}
