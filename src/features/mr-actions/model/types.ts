import type { SessionApi } from "../../../shared/api/gitlab";
import type { ActiveMergeRequest } from "../../../entities/merge-request";
import type { MrSettings } from "../../../entities/settings";
import type { Translate } from "../../../shared/i18n";

export interface MrActionContext {
  origin: string;
  projectId: number | null;
  mrIid: number | null;
  projectPath: string | null;
}
export interface MrActionUI {
  t: Translate;
  showToast: (
    message: string,
    type: "success" | "error",
    quiet?: boolean,
  ) => void;
  pollTaskStatus: (taskId: string, jobs: string[], title: string) => void;
}
export interface RepositoryFile {
  content: string;
  last_commit_id?: string;
}
export interface MergeOptions {
  squash: boolean;
  should_remove_source_branch: boolean;
}
export interface MrServices extends MrActionUI {
  context: MrActionContext;
  api: SessionApi;
  getMR: (includeRebase?: boolean) => Promise<ActiveMergeRequest>;
  getSettings: () => Promise<MrSettings>;
}
