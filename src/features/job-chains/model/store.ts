import type { ChainTask } from "./types";
const COMPLETED_TASK_RETENTION = 50;
const TASK_WAKEUP_INTERVAL_MINUTES = 1;
export const TASK_STORAGE_KEY = "job_chain_state_v1";
export const TASK_ALARM = "job-chain-wakeup";

function isTask(value: unknown): value is ChainTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<ChainTask>;
  return (
    typeof task.gitlabUrl === "string" &&
    task.gitlabUrl.startsWith("https://") &&
    typeof task.projectId === "number" &&
    typeof task.mrIid === "number" &&
    Array.isArray(task.jobs) &&
    task.jobs.every((job) => typeof job === "string") &&
    Number.isInteger(task.currentIndex) &&
    task.currentIndex! >= 0 &&
    task.currentIndex! <= task.jobs.length &&
    typeof task.status === "string" &&
    ["ready", "dispatching", "waiting", "complete"].includes(
      task.phase || "",
    ) &&
    (task.pipelineId === null ||
      task.pipelineId === undefined ||
      typeof task.pipelineId === "number")
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
        const stored = data[TASK_STORAGE_KEY];
        if (stored && typeof stored === "object") {
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
    const snapshot = JSON.parse(JSON.stringify(tasks)) as Record<
      string,
      ChainTask
    >;
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
    if (
      Object.values(tasks).some(
        (task) => task.status !== "done" && task.status !== "error",
      )
    )
      chrome.alarms.create(TASK_ALARM, {
        periodInMinutes: TASK_WAKEUP_INTERVAL_MINUTES,
      });
    else chrome.alarms.clear(TASK_ALARM);
  }
  return { load, save, syncAlarm };
}
