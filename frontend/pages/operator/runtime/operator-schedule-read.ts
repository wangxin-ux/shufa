import type { OperatorLessonSession } from "./types/operator";
import type { RequestState } from "../../../utils/request-state";
import { OperatorPageContext } from "./operator-page-context";

// The current contract has only the paginated list; every lookup starts without filters.
export async function readOperatorLesson(
  context: OperatorPageContext,
  id: string,
  accepts: () => boolean,
): Promise<RequestState<OperatorLessonSession> | undefined> {
  let lastPage: number | undefined;
  for (let page = 1; accepts(); page += 1) {
    const state = await context.service.loadLessonSessions({ page, pageSize: 20 });
    if (!context.isCurrent()) return;
    if (state.status === "error" && (state.statusCode === 401 || state.statusCode === 403)) {
      context.invalidate(state.message);
      return;
    }
    if (!accepts()) return;
    if (state.status === "error") return state;
    if (state.status !== "success" && state.status !== "empty") {
      return { status: "error", message: "课次读取未完成，请重试" };
    }
    const { data, meta } = state.data;
    if (meta.page !== page || !Number.isSafeInteger(meta.totalPages) || meta.totalPages < 0 ||
      (meta.totalPages < page && !(page === 1 && meta.totalPages === 0 && data.length === 0))) {
      return { status: "error", message: "课次分页信息异常，请重试" };
    }
    const found = data.find((lesson) => lesson.id === id);
    if (found) return { status: "success", data: found };
    // Freeze the first bound so a growing list cannot extend this scan indefinitely.
    lastPage = Math.min(lastPage ?? Math.max(1, meta.totalPages), Math.max(1, meta.totalPages));
    if (page >= lastPage) return { status: "error", statusCode: 404, message: "未找到指定课次，请刷新重试" };
    if (data.length === 0) return { status: "error", message: "课次列表已变化，请重新读取" };
  }
}
