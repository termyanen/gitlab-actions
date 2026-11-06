import { reportRuntimeError } from "../../../shared/api/runtime";
import { reportError } from "../../../shared/lib/errors";
import {
  arrayOf,
  either,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  literal,
  nullable,
  objectOf,
  optional,
} from "../../../shared/lib/validation";
import type { ChainTask } from "./types";
const COMPLETED_TASK_RETENTION = 50;
const TASK_WAKEUP_INTERVAL_MINUTES = 1;
const TASK_STORAGE_KEY = "job_chain_state_v1";
export const TASK_ALARM = "job-chain-wakeup";

const taskShape = objectOf<ChainTask>({
  gitlabUrl: isString,
  _tabId: optional(nullable(isNumber)),
  _cancelled: optional(isBoolean),
  phase: either(
    either(literal("ready"), literal("dispatching")),
    either(literal("waiting"), literal("complete")),
  ),
  pendingJobId: optional(isNumber),
  pendingOperation: optional(either(literal("play"), literal("retry"))),
  waitAttempts: optional(isNumber),
  updatedAt: optional(isNumber),
  jobs: arrayOf(isString),
  currentIndex: isNumber,
  projectId: isNumber,
  mrIid: isNumber,
  pipelineId: optional(nullable(isNumber)),
  pipelineProjectId: optional(isNumber),
  mrTitle: optional(isString),
  status: isString,
  error: optional(nullable(isString)),
});
function isTask(value: unknown): value is ChainTask {
  return (
    taskShape(value) &&
    value.gitlabUrl.startsWith("https://") &&
    Number.isInteger(value.currentIndex) &&
    value.currentIndex >= 0 &&
    value.currentIndex <= value.jobs.length
  );
}

export function createTaskStore(tasks: Record<string, ChainTask>) {
  let writes = Promise.resolve();
  function load(): Promise<void> {
    return new Promise((resolve, reject) =>
      chrome.storage.local.get(TASK_STORAGE_KEY, (data) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const stored: unknown = data[TASK_STORAGE_KEY];
        if (isRecord(stored)) {
          for (const [id, task] of Object.entries(stored))
            if (id.startsWith("task-") && isTask(task)) tasks[id] = task;
        }
        resolve();
      }),
    );
  }
  function save(): Promise<void> {
    const completed = Object.entries(tasks)
      .filter(([, task]) => task.status === "done" || task.status === "error")
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
    for (const [id] of completed.slice(COMPLETED_TASK_RETENTION))
      delete tasks[id];
    const snapshot: unknown = JSON.parse(JSON.stringify(tasks));
    const operation = writes
      .catch(() => {})
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            chrome.storage.local.set({ [TASK_STORAGE_KEY]: snapshot }, () => {
              if (chrome.runtime.lastError)
                reject(new Error(chrome.runtime.lastError.message));
              else resolve();
            });
          }),
      );
    writes = operation;
    return operation;
  }
  function syncAlarm() {
    // alarms.create returned void before Chrome 111; other supported API calls
    // use callbacks so runtime.lastError is observed on the Chrome 110 baseline.
    if (
      Object.values(tasks).some(
        (task) => task.status !== "done" && task.status !== "error",
      )
    )
      chrome.alarms
        .create(TASK_ALARM, {
          periodInMinutes: TASK_WAKEUP_INTERVAL_MINUTES,
        })
        ?.catch(reportError);
    else chrome.alarms.clear(TASK_ALARM, reportRuntimeError);
  }
  return { load, save, syncAlarm };
}
