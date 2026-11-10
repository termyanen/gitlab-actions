export { GITLAB_PAGE_SIZE as PAGE_SIZE } from "../../../shared/config/gitlab-api";

export const MAX_PAGES = 100;

export const REQUEST_TIMEOUT = 20000;

export const MAX_FILE_BYTES = 256 * 1024;

export const MAX_FILE_REQUESTS = 120;

export const MAX_SNIPPET_LINES = 60;

export const MAX_SNIPPET_CHARS = 18000;

export const MAX_REVIEW_DIFF_CHARS = 120000;

export const MAX_REVIEW_FILE_CHARS = 24000;

export const MAX_REVIEW_MESSAGE_CHARS = 60000;

// A new review stays independent; existing discussions are appended last in
// a compact form so the AI uses them only to drop duplicate findings.
export const EXISTING_SUMMARY_CHARS = 600;

export const EXISTING_TOTAL_CHARS = 60000;
