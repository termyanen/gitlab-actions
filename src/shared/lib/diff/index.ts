interface Hunk {
  oldLines: string[];
  newLines: string[];
  lastSide: string;
}
export function applyUnifiedDiff(content: string, diffText: string) {
  const srcLines = content.split("\n");
  let hadTrailingNewline = false;
  if (srcLines.length && srcLines[srcLines.length - 1] === "") {
    hadTrailingNewline = true;
    srcLines.pop();
  }

  const diffLines = diffText.split("\n");
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let oldNoNewline = false;
  let newNoNewline = false;
  let j;
  for (const [i, line] of diffLines.entries()) {
    if (line === "" && i === diffLines.length - 1) break; // diff's own trailing newline
    if (line.indexOf("@@") === 0) {
      if (!/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(line))
        throw new Error("Bad hunk header");
      cur = { oldLines: [], newLines: [], lastSide: "" };
      hunks.push(cur);
      continue;
    }
    if (!cur) {
      // Only ---/+++ file headers are allowed before the first hunk
      if (line.indexOf("--- ") === 0 || line.indexOf("+++ ") === 0) continue;
      throw new Error("Unexpected diff line");
    }
    const ch = line.charAt(0);
    const text = line.slice(1);
    if (ch === " " || line === "") {
      // Context line; a bare empty line is an empty context line
      cur.oldLines.push(line === "" ? "" : text);
      cur.newLines.push(line === "" ? "" : text);
      cur.lastSide = "both";
    } else if (ch === "-") {
      cur.oldLines.push(text);
      cur.lastSide = "old";
    } else if (ch === "+") {
      cur.newLines.push(text);
      cur.lastSide = "new";
    } else if (ch === "\\") {
      // "\ No newline at end of file" — refers to the preceding line's side
      if (cur.lastSide === "old") oldNoNewline = true;
      else if (cur.lastSide === "new") newNoNewline = true;
      else {
        oldNoNewline = true;
        newNoNewline = true;
      }
    } else {
      throw new Error("Unexpected diff line");
    }
  }
  if (!hunks.length) throw new Error("Empty diff");

  const out = [];
  let pos = 0;
  let hunkEnd = 0;
  for (const h of hunks) {
    let found = -1;
    if (!h.oldLines.length) {
      // Pure addition with zero context — unambiguous only for an empty file
      if (!srcLines.length && hunks.length === 1) found = 0;
      else throw new Error("Ambiguous hunk position");
    } else {
      for (let s = pos; s <= srcLines.length - h.oldLines.length; s++) {
        let match = true;
        for (j = 0; j < h.oldLines.length; j++) {
          if (srcLines[s + j] !== h.oldLines[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          if (found !== -1) throw new Error("Ambiguous hunk position");
          found = s;
        }
      }
      if (found === -1) throw new Error("Hunk context not found");
    }
    while (pos < found) {
      out.push(srcLines[pos]);
      pos++;
    }
    for (j = 0; j < h.newLines.length; j++) out.push(h.newLines[j]);
    pos = found + h.oldLines.length;
    hunkEnd = pos;
  }
  // The old side lacking a trailing newline means the last hunk must reach
  // EOF and the content must not end with a newline either
  if (oldNoNewline && (hadTrailingNewline || hunkEnd !== srcLines.length)) {
    throw new Error("Trailing newline mismatch");
  }
  if (newNoNewline && hunkEnd !== srcLines.length) {
    throw new Error("Trailing newline mismatch");
  }
  // Symmetric case: the last hunk reaches EOF and the old side DOES end with
  // a newline (no "\" marker) — then the content must end with one too.
  // A last line that matches textually but lacks the newline is a real
  // divergence in the changed region (git would conflict on it)
  if (!oldNoNewline && hunkEnd === srcLines.length && !hadTrailingNewline) {
    throw new Error("Trailing newline mismatch");
  }
  while (pos < srcLines.length) {
    out.push(srcLines[pos]);
    pos++;
  }

  const trailing = newNoNewline
    ? false
    : oldNoNewline
      ? true
      : hadTrailingNewline;
  return out.join("\n") + (trailing ? "\n" : "");
}
