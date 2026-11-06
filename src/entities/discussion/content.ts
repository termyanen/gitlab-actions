import type { Discussion } from "./model/types";
export function getNotes(discussion: Discussion | null | undefined) {
  return discussion && Array.isArray(discussion.notes)
    ? discussion.notes.filter(function (note) {
        return note && !note.system;
      })
    : [];
}

export function getStatus(discussion: Discussion) {
  const notes = getNotes(discussion);
  let resolvable = notes.filter(function (note) {
    return (
      note.resolvable === true ||
      (note.resolvable !== false && note.resolved === true)
    );
  });
  if (
    resolvable.length ||
    (discussion &&
      (discussion.resolvable === true ||
        (discussion.resolvable !== false && discussion.resolved === true)))
  ) {
    resolvable = notes.filter(function (note) {
      return (
        note.resolvable === true ||
        (note.resolvable !== false && typeof note.resolved === "boolean")
      );
    });
    if (resolvable.length)
      return resolvable.every(function (note) {
        return note.resolved === true;
      })
        ? "resolved"
        : "unresolved";
  }
  if (
    !notes.length ||
    notes.every(function (note) {
      return note.resolvable === false;
    }) ||
    discussion.resolvable === false
  )
    return "general";
  if (discussion.resolved === true) return "resolved";
  return discussion.resolvable === true ? "unresolved" : "general";
}
