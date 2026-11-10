export type {
  Discussion,
  DraftNote,
  Note,
  NoteAuthor,
  NotePosition,
} from "./model/types";

export { readDiscussion, readDraftNote, readNote } from "./model/validation";

export type { CreatedComment } from "./model/types";
export { isDiscussion, isNote, readCreatedComment } from "./model/validation";

export { isDraftNote } from "./model/validation";
