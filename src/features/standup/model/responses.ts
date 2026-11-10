import { errorMessage } from "../../../shared/lib/errors";
import {
  decoder,
  isNumber,
  isString,
  optional,
  nullable,
  isRecord,
  isUnknownArray,
  type Guard,
  type Decoder,
} from "../../../shared/lib/validation";
// Report only schema paths, never response values (titles, notes or credentials).
function readObject<T extends object>(fields: {
  [K in keyof T]-?: Decoder<T[K]>;
}): Decoder<T> {
  return (value) => {
    const guard: Guard<T> = (candidate): candidate is T => {
      if (!isRecord(candidate)) throw new Error("object");
      for (const key in fields) {
        try {
          fields[key](candidate[key]);
        } catch (error) {
          throw new Error(key + "." + errorMessage(error));
        }
      }
      return true;
    };
    return decoder(guard)(value);
  };
}
function readList<T>(read: Decoder<T>): Decoder<T[]> {
  return (value) => {
    if (!isUnknownArray(value)) throw new Error("list");
    return value.map((entry, index) => {
      try {
        return read(entry);
      } catch (error) {
        throw new Error(`[${index}].${errorMessage(error)}`);
      }
    });
  };
}
function response<T>(source: string, read: Decoder<T>): Decoder<T> {
  return (value) => {
    try {
      return read(value);
    } catch (error) {
      throw new Error(
        `Invalid GitLab ${source} response: ${errorMessage(error)}`,
      );
    }
  };
}
const number = decoder(isNumber, "number");
const string = decoder(isString, "string");
const optionalString = decoder(optional(isString), "optional string");
const nullableString = decoder(
  optional(nullable(isString)),
  "optional nullable string",
);
export const readCurrentUser = response(
  "current user",
  readObject<{ id: number; username: string }>({
    id: number,
    username: string,
  }),
);
export const readActivityEvent = response(
  "activity events",
  readList(
    readObject<ActivityEvent>({
      project_id: number,
      created_at: optionalString,
      action_name: string,
      note: (value) =>
        value === undefined
          ? undefined
          : readObject<NonNullable<ActivityEvent["note"]>>({
              id: number,
              noteable_type: string,
              noteable_iid: decoder(
                optional(nullable(isNumber)),
                "optional nullable number",
              ),
            })(value),
      target_type: nullableString,
      target_iid: decoder(nullable(isNumber), "nullable number"),
      target_title: nullableString,
      push_data: (value) =>
        value === undefined
          ? undefined
          : readObject<NonNullable<ActivityEvent["push_data"]>>({
              ref: decoder(nullable(isString), "nullable string"),
              ref_type: string,
              commit_count: decoder(optional(isNumber), "optional number"),
            })(value),
    }),
  ),
);
export const readActivityMr = response(
  "merge requests",
  readList(
    readObject<ActivityMr>({
      id: number,
      iid: number,
      title: string,
      created_at: optionalString,
      merged_at: nullableString,
      references: (value) =>
        value === undefined
          ? undefined
          : readObject<{ full?: string }>({ full: optionalString })(value),
      pipeline: (value) =>
        value === undefined || value === null
          ? value
          : readObject<{ status: string }>({ status: string })(value),
    }),
  ),
);
export const readProjectPath = response(
  "project",
  readObject<{ path_with_namespace: string }>({ path_with_namespace: string }),
);

export interface ActivityMr {
  id: number;
  iid: number;
  title: string;
  created_at?: string;
  merged_at?: string | null;
  references?: { full?: string };
  pipeline?: { status: string } | null;
}
export interface ActivityEvent {
  project_id: number;
  created_at?: string;
  action_name: string;
  note?: { id: number; noteable_type: string; noteable_iid?: number | null };
  target_type?: string | null;
  target_iid: number | null;
  target_title?: string | null;
  push_data?: { ref: string | null; ref_type: string; commit_count?: number };
}
