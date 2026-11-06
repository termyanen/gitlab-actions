export interface ToolbarButton {
  label: string;
  cls: string;
  action: () => Promise<unknown>;
  name: string;
  confirm?: string;
  hide?: boolean;
  quiet?: boolean;
  reloadOnSuccess?: boolean;
}
export interface TaskStatus {
  taskId: string;
  jobs: string[];
  status: string;
  error?: string;
  mrTitle?: string;
}
export interface PaletteAction {
  id: string;
  label: string;
  icon: string;
}
export interface Tracker {
  updateTrackerItem(
    taskId: string,
    jobs: string[],
    status: string,
    error?: string | null,
    title?: string,
  ): void;
  restoreActiveTasks(): void;
  pollTaskStatus(taskId: string, jobs: string[], title?: string): void;
}
