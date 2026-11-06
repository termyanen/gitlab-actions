import type { ProxyTask } from "../../../shared/api/background-proxy";
export interface ChainTask extends ProxyTask {
  phase?: "ready" | "dispatching" | "waiting" | "complete";
  pendingJobId?: number;
  pendingOperation?: "play" | "retry";
  waitAttempts?: number;
  updatedAt?: number;
  jobs: string[];
  currentIndex: number;
  projectId: number;
  mrIid: number;
  pipelineId?: number | null;
  pipelineProjectId?: number;
  mrTitle?: string;
  status: string;
  error?: string | null;
}
export type ChainMessage =
  | {
      type: "start-job-chain";
      gitlabUrl: string;
      projectId: number;
      mrIid: number;
      jobs: string[];
      mrTitle?: string;
    }
  | { type: "get-task-status" | "cancel-task"; taskId: string }
  | { type: "get-active-tasks" };
