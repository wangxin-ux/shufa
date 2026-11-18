import type { RequestState } from "../../../../utils/request-state";
import type {
  OperatorSeriesPattern, OperatorSeriesCreateInput, OperatorSeriesCreated, OperatorCancellationInput,
  OperatorCancellationPreview, OperatorSeriesCancelled, OperatorPage, OperatorLessonSession, OperatorLessonQuery,
} from "../types/operator";
import { validateSeriesPattern, validateCancellation, seriesDate } from "./operator-lesson-series.presenter";

export type OperatorSeriesOutcome<T> =
  | { status: "success"; data: T }
  | { status: "error" | "validation" | "forbidden"; message: string; retryable?: boolean }
  | { status: "conflict"; message: string; conflictDates?: string[] };
interface SeriesService {
  createLessonSeries(input: OperatorSeriesCreateInput, key: string): Promise<RequestState<OperatorSeriesCreated>>;
  cancelLessonSelection(id: string, input: OperatorCancellationInput, expected: OperatorCancellationPreview,
    key: string): Promise<RequestState<OperatorSeriesCancelled>>;
}
let sequence = 0;
export class OperatorLessonSeriesWorkflow {
  private readonly keys = new Map<string, string>();
  private readonly pending = new Map<string, Promise<OperatorSeriesOutcome<unknown>>>();
  constructor(private readonly service: SeriesService) {}
  create(input: OperatorSeriesCreateInput): Promise<OperatorSeriesOutcome<OperatorSeriesCreated>> {
    validateSeriesPattern(input, true);
    return this.run("create", input, key => this.service.createLessonSeries(input, key));
  }
  cancel(id: string, input: OperatorCancellationInput, expected: OperatorCancellationPreview):
  Promise<OperatorSeriesOutcome<OperatorSeriesCancelled>> {
    validateCancellation(id, input.mode, input.previewHash);
    return this.run(`cancel:${id}`, input, key => this.service.cancelLessonSelection(id, input, expected, key));
  }
  private run<T>(operation: string, input: unknown, invoke: (key: string) => Promise<RequestState<T>>):
  Promise<OperatorSeriesOutcome<T>> {
    const signature = `${operation}:${JSON.stringify(input)}`;
    const current = this.pending.get(signature);
    if (current) return current as Promise<OperatorSeriesOutcome<T>>;
    const key = this.keys.get(signature) ?? `operator-series-${Date.now()}-${++sequence}`;
    this.keys.set(signature, key);
    const promise = invoke(key).then((state): OperatorSeriesOutcome<T> => {
      if (state.status === "success") { this.keys.delete(signature); return { status: "success", data: state.data }; }
      if (state.status !== "error") return { status: "error", message: "操作结果尚未确认，请先读取课表", retryable: true };
      const retryable = !state.statusCode || state.statusCode >= 500;
      if (!retryable) this.keys.delete(signature);
      if (state.statusCode === 401 || state.statusCode === 403) return { status: "forbidden", message: state.message };
      if (state.statusCode === 409) {
        const dates = state.details?.conflictDates;
        return { status: "conflict", message: state.message,
          ...(Array.isArray(dates) && dates.every(seriesDate) ? { conflictDates: dates } : {}) };
      }
      return { status: "error", message: state.message, retryable };
    }).finally(() => { if (this.pending.get(signature) === promise) this.pending.delete(signature); });
    this.pending.set(signature, promise);
    return promise;
  }
}
export async function readOperatorSeriesAuthority(service: {
  loadLessonSessions(query: OperatorLessonQuery): Promise<RequestState<OperatorPage<OperatorLessonSession>>>;
}, accepts: () => boolean): Promise<RequestState<OperatorLessonSession[]> | undefined> {
  const lessons: OperatorLessonSession[] = [];
  let total: number | undefined, lastPage = 1;
  for (let page = 1; page <= lastPage && accepts(); page++) {
    const result = await service.loadLessonSessions({ page, pageSize: 20 });
    if (!accepts()) return;
    if (result.status === "error") return result;
    if (result.status !== "success" && result.status !== "empty")
      return { status: "error", message: "课表尚未读取完成" };
    if (total !== undefined && total !== result.data.meta.total)
      return { status: "error", message: "课表分页已变化，请重新核对" };
    total = result.data.meta.total; lastPage = Math.max(1, result.data.meta.totalPages);
    lessons.push(...result.data.data);
    if (new Set(lessons.map(row => row.id)).size !== lessons.length)
      return { status: "error", message: "课表分页重复，请重新核对" };
  }
  if (accepts() && total === lessons.length) return { status: "success", data: lessons };
  return accepts() ? { status: "error", message: "课表尚未完整读取" } : undefined;
}
