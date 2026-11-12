export class TextMergeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Edit {
  start: number;
  end: number;
  lines: string[];
}
// Bound synchronous diff work and trace storage for unusually divergent files.
const MAX_MERGE_WORK = 2_000_000;
const MAX_EDIT_DISTANCE = 2_048;

function lines(text: string) {
  if (text.includes("\0"))
    throw new TextMergeError(
      "CP_BINARY",
      "Binary content cannot be merged as text",
    );
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function edits(base: string[], changed: string[]): Edit[] {
  const trace: Int32Array[] = [];
  let work = 0;
  const value = (
    row: Int32Array | undefined,
    depth: number,
    diagonal: number,
  ) => row?.[diagonal + depth] ?? -1;
  for (
    let depth = 0;
    depth <= Math.min(base.length + changed.length, MAX_EDIT_DISTANCE);
    depth++
  ) {
    const row = new Int32Array(2 * depth + 1).fill(-1);
    work += row.length;
    if (work > MAX_MERGE_WORK)
      throw new TextMergeError(
        "CP_WORK_LIMIT",
        "Text merge work limit exceeded",
      );
    const previous = trace[depth - 1];
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      let x =
        depth === 0
          ? 0
          : diagonal === -depth ||
              (diagonal !== depth &&
                value(previous, depth - 1, diagonal - 1) <
                  value(previous, depth - 1, diagonal + 1))
            ? value(previous, depth - 1, diagonal + 1)
            : value(previous, depth - 1, diagonal - 1) + 1;
      let y = x - diagonal;
      while (x < base.length && y < changed.length && base[x] === changed[y]) {
        if (++work > MAX_MERGE_WORK)
          throw new TextMergeError(
            "CP_WORK_LIMIT",
            "Text merge work limit exceeded",
          );
        x++;
        y++;
      }
      row[diagonal + depth] = x;
      if (x >= base.length && y >= changed.length) {
        trace.push(row);
        const operations: ("equal" | "add" | "remove")[] = [];
        for (let step = depth; step > 0; step--) {
          const prior = trace[step - 1];
          const k = x - y;
          const priorK =
            k === -step ||
            (k !== step &&
              value(prior, step - 1, k - 1) < value(prior, step - 1, k + 1))
              ? k + 1
              : k - 1;
          const priorX = value(prior, step - 1, priorK);
          const priorY = priorX - priorK;
          while (x > priorX && y > priorY) {
            operations.push("equal");
            x--;
            y--;
          }
          if (x === priorX) {
            operations.push("add");
            y--;
          } else {
            operations.push("remove");
            x--;
          }
        }
        while (x > 0 && y > 0) {
          operations.push("equal");
          x--;
          y--;
        }
        const result: Edit[] = [];
        let position = 0;
        let index = 0;
        let current: Edit | undefined;
        for (const operation of operations.reverse()) {
          if (operation === "equal") {
            current = undefined;
            position++;
            index++;
            continue;
          }
          if (!current) {
            current = { start: position, end: position, lines: [] };
            result.push(current);
          }
          if (operation === "remove") {
            current.end++;
            position++;
          } else {
            const line = changed[index++];
            if (line === undefined)
              throw new TextMergeError(
                "CP_ALIGNMENT",
                "Invalid merge alignment",
              );
            current.lines.push(line);
          }
        }
        return result;
      }
    }
    trace.push(row);
  }
  throw new TextMergeError("CP_EDIT_LIMIT", "Text merge edit limit exceeded");
}

function requireUniqueRegions(changes: Edit[], base: string[]) {
  let work = 0;
  for (const change of changes) {
    const start =
      change.start === change.end
        ? Math.max(0, change.start - 1)
        : change.start;
    const end =
      change.start === change.end
        ? Math.min(base.length, change.start + 1)
        : change.end;
    const region = base.slice(start, end);
    let matches = 0;
    for (
      let position = 0;
      position <= base.length - region.length;
      position++
    ) {
      let match = true;
      for (let index = 0; index < region.length; index++) {
        if (++work > MAX_MERGE_WORK)
          throw new TextMergeError(
            "CP_WORK_LIMIT",
            "Text merge work limit exceeded",
          );
        if (base[position + index] !== region[index]) {
          match = false;
          break;
        }
      }
      if (match && ++matches > 1)
        throw new TextMergeError(
          "CP_REPEATED_TEXT",
          "Ambiguous repeated text changes",
        );
    }
  }
}

function sameEdit(left: Edit, right: Edit) {
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.lines.length === right.lines.length &&
    left.lines.every((line, index) => line === right.lines[index])
  );
}
function groupEdits(edits: Edit[], base: string[]) {
  // Three unchanged context lines keep nearby operations in one change region.
  // Otherwise repeated lines can hide a replacement as insertion + shared deletion.
  const grouped: Edit[] = [];
  for (const edit of edits) {
    const previous = grouped[grouped.length - 1];
    if (previous && edit.start - previous.end <= 3) {
      previous.lines.push(
        ...base.slice(previous.end, edit.start),
        ...edit.lines,
      );
      previous.end = edit.end;
    } else grouped.push({ ...edit, lines: [...edit.lines] });
  }
  return grouped;
}

/** Merge disjoint line edits against the actual parent, preserving target-only edits. */
export function mergeText(parent: string, source: string, target: string) {
  if (parent === target || source === target) return source;
  if (parent === source) return target;
  const base = lines(parent);
  const sourceEdits = edits(base, lines(source));
  const targetEdits = edits(base, lines(target));
  requireUniqueRegions(sourceEdits, base);
  requireUniqueRegions(targetEdits, base);
  if (
    sourceEdits.every((edit) =>
      targetEdits.some((other) => sameEdit(edit, other)),
    )
  )
    return target;
  const incoming = groupEdits(sourceEdits, base);
  const local = groupEdits(targetEdits, base);
  const combined = [...local];
  for (const change of incoming) {
    let duplicate = false;
    for (const other of local) {
      if (
        change.start === other.start &&
        change.end === other.end &&
        change.lines.length === other.lines.length &&
        change.lines.every((line, index) => line === other.lines[index])
      ) {
        duplicate = true;
        continue;
      }
      // Touching edits, including insertions at an edited boundary, need manual review.
      if (change.start <= other.end && other.start <= change.end)
        throw new TextMergeError("CP_OVERLAP", "Overlapping text changes");
    }
    if (!duplicate) combined.push(change);
  }
  combined.sort((a, b) => a.start - b.start || a.end - b.end);
  const output: string[] = [];
  let position = 0;
  for (const change of combined) {
    output.push(...base.slice(position, change.start), ...change.lines);
    position = change.end;
  }
  output.push(...base.slice(position));
  return output.join("");
}
