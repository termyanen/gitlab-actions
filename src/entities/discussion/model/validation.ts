import {
  arrayOf,
  decoder,
  either,
  isBoolean,
  isNumber,
  isString,
  literal,
  nullable,
  objectOf,
  optional,
} from "../../../shared/lib/validation";
import type {
  CreatedComment,
  Discussion,
  DraftNote,
  Note,
  NoteAuthor,
  NoteLine,
  NotePosition,
} from "./types";

const id = either(isString, isNumber);
const author = objectOf<NoteAuthor>({
  id: optional(isNumber),
  name: optional(isString),
  username: optional(isString),
});
const lineFields = {
  old_line: optional(nullable(isNumber)),
  new_line: optional(nullable(isNumber)),
  line_code: optional(isString),
  type: optional(either(literal("old"), literal("new"))),
};
const position = objectOf<NotePosition>({
  ...lineFields,
  old_path: optional(nullable(isString)),
  new_path: optional(nullable(isString)),
  base_sha: optional(isString),
  start_sha: optional(isString),
  head_sha: optional(isString),
  position_type: optional(isString),
  line_range: optional(
    nullable(
      objectOf<{ start?: NoteLine; end?: NoteLine }>({
        start: optional(objectOf<NoteLine>(lineFields)),
        end: optional(objectOf<NoteLine>(lineFields)),
      }),
    ),
  ),
  x: optional(isNumber),
  y: optional(isNumber),
  width: optional(isNumber),
  height: optional(isNumber),
});
const noteFields = {
  id,
  body: isString,
  system: optional(isBoolean),
  created_at: optional(isString),
  author: optional(nullable(author)),
  resolvable: optional(isBoolean),
  resolved: optional(isBoolean),
  outdated: optional(isBoolean),
  position: optional(nullable(position)),
  original_position: optional(nullable(position)),
  noteable_type: optional(isString),
  commit_id: optional(nullable(isString)),
  type: optional(nullable(isString)),
  web_url: optional(isString),
  attachment: optional(nullable(isString)),
  draft: optional(isBoolean),
  draft_id: optional(id),
};
export const isNote = objectOf<Note>({
  ...noteFields,
  notes: literal(undefined),
});
export const readNote = decoder(isNote, "GitLab note response");
export const isDiscussion = objectOf<Discussion>({
  id: isString,
  notes: arrayOf(isNote),
  notes_count: optional(isNumber),
  individual_note: optional(isBoolean),
  resolvable: optional(isBoolean),
  resolved: optional(isBoolean),
  outdated: optional(isBoolean),
  truncated: optional(isBoolean),
  has_more: optional(isBoolean),
  body: literal(undefined),
});
export const readDiscussion = decoder(
  isDiscussion,
  "GitLab discussion response",
);
export const isDraftNote = objectOf<DraftNote>({
  id,
  note: isString,
  author: optional(nullable(author)),
  position: optional(nullable(position)),
  discussion_id: optional(nullable(id)),
  author_id: optional(isNumber),
});
export const readDraftNote = decoder(isDraftNote, "GitLab draft response");
function isCreatedComment(value: unknown): value is CreatedComment {
  return createdComment(value);
}
const createdComment = objectOf<CreatedComment>({
  ...noteFields,
  id: optional(id),
  body: optional(isString),
  note: optional(isString),
  notes: optional(arrayOf(isCreatedComment)),
  discussion_id: optional(isString),
  resolve_discussion: optional(isBoolean),
});
export const readCreatedComment = decoder(
  isCreatedComment,
  "created GitLab comment",
);
