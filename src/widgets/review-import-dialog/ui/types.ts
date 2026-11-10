import type { createCommentPreviews } from "../../../shared/ui/review-comment";
import type {
  ImportPlan,
  ImportResultItem,
} from "../../../features/review-import";
import type { ReviewContext } from "../../../entities/review";
import type { Translate } from "../../../shared/i18n";

export interface ImportDialogState {
  commentPreviews?: ReturnType<typeof createCommentPreviews>;
  commentChoices?: Map<string, boolean>;
  expandComments: HTMLButtonElement;
  context: ReviewContext;
  t: Translate;
  previousFocus: HTMLElement | null;
  selected: Set<string>;
  resolveSelected: Set<string>;
  results: Map<string, ImportResultItem>;
  plan: ImportPlan | null;
  editor: { id: string; body: string; add: boolean; error?: string } | null;
  manualId: number;
  busy: "" | "checking" | "sending" | "prompt" | "revising";
  stopping?: boolean;
  retainedRoute?: string;
  run: number;
  controller?: AbortController;
  overlay: HTMLDivElement;
  dialog: HTMLElement;
  subject: HTMLParagraphElement;
  status: HTMLDivElement;
  warning: HTMLDivElement;
  copyPrompt: HTMLButtonElement;
  copyReplyPrompt: HTMLButtonElement;
  copyFormat: HTMLButtonElement;
  promptDetails: HTMLDetailsElement;
  promptSummary: HTMLElement;
  prompt: HTMLTextAreaElement;
  input: HTMLTextAreaElement;
  validate: HTMLButtonElement;
  select: HTMLButtonElement;
  clear: HTMLButtonElement;
  add: HTMLButtonElement;
  count: HTMLDivElement;
  list: HTMLDivElement;
  replyHint: HTMLParagraphElement;
  stop: HTMLButtonElement;
  drafts: HTMLButtonElement;
  publish: HTMLButtonElement;
  editorInput: HTMLTextAreaElement | null;
  saveEdit: HTMLButtonElement | null;
  onKeydown: (event: KeyboardEvent) => void;
}
