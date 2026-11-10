import type { Discussion, NoteAuthor } from "../../../entities/discussion";
import type { DiffRefs, MergeRequest } from "../../../entities/merge-request";
import type {
  FileFilter,
  InstructionOptions,
  ReviewContext,
} from "../../../entities/review";

export type { ReviewContext, ReviewLocation } from "../../../entities/review";
export interface ExportOptions extends InstructionOptions {
  fresh?: boolean;
  raw?: boolean;
  maxBytes?: number;
  onProgress?: (value: {
    phase: string;
    page?: number;
    loaded: number;
    total?: number;
  }) => void;
  noteId?: string | number;
  noteAnchor?: string;
  visibleNote?: { body: string; author?: NoteAuthor; format?: string };
  discussionIds?: (string | number)[];
  noteIds?: (string | number)[];
  prompt?: string;
  includeDescription?: boolean;
  includeReplies?: boolean;
  includeCode?: boolean;
  includeExisting?: boolean;
  fileFilter?: FileFilter;
  repeat?: boolean;
  baselineHead?: string;
}

export interface ReviewSnapshot {
  context: ReviewContext;
  entity: MergeRequest | null;
  discussions: Discussion[];
  warnings: string[];
  complete: boolean;
  loadedAt?: string;
}

export interface ReviewResult {
  text?: string;
  sections?: string[];
  warnings: string[];
  complete: boolean;
  refs: DiffRefs;
  headSha: string;
  sourceProjectId?: number | string;
  fileCount: number | null;
  commitCount: number | null;
  excludedFiles: { path: string; old_path?: string; reason: string }[];
  existingCount?: number | null;
  baselineHead?: string | null;
}

export interface RequestResult<T> {
  data: T;
  response: Response;
}

export interface ReviewError extends Error {
  httpStatus?: number;
}

export type FileReader = (
  project: number | string,
  path: string,
  ref: string,
) => Promise<string>;
