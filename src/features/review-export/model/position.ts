import type { NotePosition } from "../../../entities/discussion";
export function validLine(value: unknown) {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value)
    : null;
}

export function anchorLine(position: NotePosition, side: "old" | "new") {
  const range = position.line_range || {};
  return (
    validLine(range.start && range.start[`${side}_line`]) ||
    validLine(position[`${side}_line`]) ||
    validLine(range.end && range.end[`${side}_line`])
  );
}
