export interface NoteAuthor {
  id?: number;
  username?: string;
  name?: string;
}

interface NoteLine {
  old_line?: number | null;
  new_line?: number | null;
  line_code?: string;
  type?: "old" | "new";
}

export interface NotePosition extends NoteLine {
  old_path?: string;
  new_path?: string;
  base_sha?: string;
  start_sha?: string;
  head_sha?: string;
  position_type?: string;
  line_range?: { start?: NoteLine; end?: NoteLine } | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface Note {
  id: string | number;
  body: string;
  system?: boolean;
  created_at?: string;
  author?: NoteAuthor;
  resolvable?: boolean;
  resolved?: boolean;
  outdated?: boolean;
  position?: NotePosition | null;
  original_position?: NotePosition | null;
  noteable_type?: string;
  commit_id?: string;
  type?: string | null;
  web_url?: string;
  attachment?: string | null;
  draft?: boolean;
  draft_id?: string | number;
  notes?: never;
}

export interface DraftNote {
  id: string | number;
  note: string;
  author?: NoteAuthor;
  position?: NotePosition | null;
  discussion_id?: string | number;
}

export interface Discussion {
  id: string;
  notes: Note[];
  notes_count?: number;
  individual_note?: boolean;
  resolvable?: boolean;
  resolved?: boolean;
  outdated?: boolean;
  truncated?: boolean;
  has_more?: boolean;
  body?: never;
}
