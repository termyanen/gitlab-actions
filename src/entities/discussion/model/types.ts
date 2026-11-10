export interface NoteAuthor {
  id?: number;
  username?: string;
  name?: string;
}

export interface NoteLine {
  old_line?: number | null;
  new_line?: number | null;
  line_code?: string;
  type?: "old" | "new";
}

export interface NotePosition extends NoteLine {
  old_path?: string | null;
  new_path?: string | null;
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
  author?: NoteAuthor | null;
  resolvable?: boolean;
  resolved?: boolean;
  outdated?: boolean;
  position?: NotePosition | null;
  original_position?: NotePosition | null;
  noteable_type?: string;
  commit_id?: string | null;
  type?: string | null;
  web_url?: string;
  attachment?: string | null;
  draft?: boolean;
  draft_id?: string | number;
  notes?: never;
}

export interface DraftNote {
  author_id?: number;
  id: string | number;
  note: string;
  author?: NoteAuthor | null;
  position?: NotePosition | null;
  discussion_id?: string | number | null;
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

export interface CreatedComment extends Omit<Partial<Note>, "notes"> {
  note?: string;
  notes?: CreatedComment[];
  discussion_id?: string;
  resolve_discussion?: boolean;
}
