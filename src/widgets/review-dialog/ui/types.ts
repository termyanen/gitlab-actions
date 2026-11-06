import type { ReviewContext, FileFilter } from "../../../entities/review";
import type {
  ReviewSnapshot,
  ExportOptions,
} from "../../../features/review-export";
import type { Translate } from "../../../shared/i18n";

export type ReviewTask = "feedback" | "fresh" | "replies" | "repeat";
export interface ReviewIntent {
  noteId?: string;
  noteAnchor?: string;
  visibleNote?: ExportOptions["visibleNote"];
}
export interface ImportDialog {
  close(force?: boolean): boolean;
  open(context: ReviewContext, options: { t: Translate }): void;
}
export interface ReviewSettings {
  [key: string]: unknown;
  show_ai_review_copy: boolean;
  ai_review_prompt: string;
  ai_review_fresh_prompt: string;
  ai_review_file_filter: Partial<FileFilter>;
  ai_review_include_description: boolean | null;
  ai_review_fresh_existing: boolean;
  ai_review_reply_prompt: string;
  ai_review_repeat_prompt: string;
  ai_review_confirm_close: boolean;
  language: string;
}
export interface ReviewDialogState {
  context: ReviewContext;
  intent: ReviewIntent;
  selected: Set<string>;
  selectionEdited: boolean;
  exportRun: number;
  previousFocus: HTMLElement | null;
  task: ReviewTask;
  taskChanged?: boolean;
  tabs: HTMLButtonElement[];
  prompts: Record<ReviewTask, string>;
  promptMode?: ReviewTask;
  filterFields: { key: keyof FileFilter; input: HTMLTextAreaElement }[];
  snapshot?: ReviewSnapshot | null;
  prepared?: { text: string } | null;
  loadController?: AbortController | null;
  exportController?: AbortController;
  versionsController?: AbortController;
  busy?: boolean;
  loading?: boolean;
  needsLoad?: boolean;
  descriptionSaveFailed?: boolean;
  initialValues: string;
  initialSelection?: string;
  intentFound?: boolean;
  onKeydown: (event: KeyboardEvent) => void;
  allButton: HTMLButtonElement;
  baseline: HTMLElementTagNameMap["select"];
  baselineSha: HTMLElementTagNameMap["input"];
  body: HTMLDivElement;
  cancelButton: HTMLButtonElement;
  clearButton: HTMLButtonElement;
  codeHint: HTMLParagraphElement;
  codeToggle: HTMLLabelElement;
  contextHint: HTMLElementTagNameMap["p"];
  copyButton: HTMLButtonElement;
  count: HTMLElementTagNameMap["div"];
  descriptionToggle: HTMLLabelElement;
  emptyHint: HTMLElementTagNameMap["p"];
  existingHint: HTMLElementTagNameMap["p"];
  existingToggle: HTMLElementTagNameMap["label"];
  filter: HTMLElementTagNameMap["select"];
  generalToggle: HTMLElementTagNameMap["label"];
  includeCode: HTMLElementTagNameMap["input"];
  includeDescription: HTMLElementTagNameMap["input"];
  includeExisting: HTMLElementTagNameMap["input"];
  includeGeneral: HTMLElementTagNameMap["input"];
  includeReplies: HTMLElementTagNameMap["input"];
  list: HTMLElementTagNameMap["div"];
  nextStep: HTMLElementTagNameMap["p"];
  output: HTMLElement;
  overlay: HTMLElementTagNameMap["div"];
  picker: HTMLElementTagNameMap["section"];
  preview: HTMLElementTagNameMap["textarea"];
  previewButton: HTMLButtonElement;
  previewDetails: HTMLElementTagNameMap["details"];
  prompt: HTMLElementTagNameMap["textarea"];
  promptLabel: HTMLElementTagNameMap["summary"];
  refreshButton: HTMLButtonElement;
  repeatOptions: HTMLDivElement;
  repliesToggle: HTMLElementTagNameMap["label"];
  retryButton: HTMLButtonElement;
  scopeOptions: HTMLDetailsElement;
  search: HTMLElementTagNameMap["input"];
  selectButton: HTMLButtonElement;
  size: HTMLElementTagNameMap["div"];
  status: HTMLElementTagNameMap["div"];
  subject: HTMLElementTagNameMap["p"];
  taskHint: HTMLElementTagNameMap["p"];
  taskSummary: HTMLElementTagNameMap["p"];
  threadButton: HTMLButtonElement;
  unresolvedButton: HTMLButtonElement;
  versionsHint: HTMLElementTagNameMap["p"];
  warning: HTMLElementTagNameMap["div"];
}
