import type {
  Discussion,
  Note,
  NotePosition,
  NoteAuthor,
} from "../../../entities/discussion";
import type { DiffRefs } from "../../../entities/merge-request";
import type {
  ReviewContext,
  InstructionOptions,
  FileFilter,
} from "../../../entities/review";

export interface ImportOptions extends InstructionOptions {
  onProgress?: (value: {
    phase: string;
    completed?: number;
    total?: number;
    item?: ImportResultItem;
  }) => void;
  csrfToken?: string;
  maxBytes?: number;
  prompt?: string;
  fileFilter?: FileFilter;
  discussionIds?: (string | number)[];
  mode?: "draft" | "publish";
  resolveIds?: string[];
}

/** Input is checked at runtime before a comment can enter the send plan. */
export interface ImportComment {
  [field: string]: unknown;
  id: string;
  type?: "reply" | "comment";
  body: string;
  path?: string | null;
  side?: "old" | "new" | null;
  line?: number | null;
  code?: string | null;
  discussion_id?: string;
  note_id?: number;
}
export interface ReviewInput {
  version: 1;
  mr_url: string;
  head_sha?: string | null;
  comments: ImportComment[];
}
export interface ReplyContext {
  body: string;
  url: string;
  author?: NoteAuthor;
  path?: string;
  side?: "old" | "new";
  line?: number | null;
  resolvable?: boolean;
  resolved?: boolean;
}
export interface CompactLocation {
  path?: string;
  side: "old" | "new";
  line?: number;
  head_sha?: string;
  base_sha?: string;
}
export interface ReplyThreadNote {
  note_id: number | string;
  body: string;
  author?: string;
  resolved?: boolean;
}
export interface ReplyThread {
  discussion_id: string;
  note_id: number | string;
  url: string;
  comments: ReplyThreadNote[];
  location?: CompactLocation;
  original_location?: CompactLocation;
}
export interface ImportItem extends ImportComment {
  type: "reply" | "comment";
  status: "ready" | "invalid" | "duplicate";
  message: string;
  position: NotePosition | null;
  editable: boolean;
  replyTo?: ReplyContext;
  existingUrl?: string;
  url?: never;
  resolveStatus?: never;
  resolveMessage?: never;
}
export interface ImportPlan {
  context: ReviewContext;
  headSha: string;
  refs: DiffRefs;
  mrTitle: string;
  items: ImportItem[];
  warnings: string[];
  draftSupported: boolean;
  source: ReviewInput;
}
export interface InternalPlan {
  context: ReviewContext;
  refs: DiffRefs;
  items: ImportItem[];
  userId: number;
  replyFingerprints: Record<string, string>;
  source: ReviewInput;
  outcomes: Record<string, ImportResultItem["status"]>;
}
export interface ImportEdit {
  id: string;
  body: string;
  add?: boolean;
}
export interface ImportResultItem {
  id: string;
  status:
    "published" | "draft" | "unknown" | "duplicate" | "skipped" | "failed";
  message: string;
  url?: string;
  resolveStatus?: "resolved" | "unknown" | "failed";
  resolveMessage?: string;
}
export interface ImportResult {
  items: ImportResultItem[];
  warnings: string[];
}
export interface ExistingNote {
  id: number | string;
  body: string;
  position: NotePosition | null;
  url: string;
  draft: boolean;
  discussion_id: string | number | null;
  isReply: boolean;
}
export interface ExistingNotes {
  notes: ExistingNote[];
  discussions: Discussion[];
  userId: number;
  draftSupported: boolean;
}
export interface JournalEntry {
  status: "pending" | "unknown" | "draft" | "published";
  time: number;
  id?: number;
}
export interface ImportError extends Error {
  httpStatus?: number;
  beforeSend?: boolean;
}
export interface DiffLine {
  code: string;
  old_line: number | null;
  new_line: number | null;
}
export interface VerifiedDiff {
  old_path: string;
  new_path: string;
  lines?: { old: Map<number, DiffLine>; new: Map<number, DiffLine> };
  error?: string;
}
export interface CreatedComment extends Omit<Partial<Note>, "notes"> {
  note?: string;
  notes?: CreatedComment[];
  discussion_id?: string;
  resolve_discussion?: boolean;
}
