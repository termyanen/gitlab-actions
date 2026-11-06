import type { ExportOptions } from "./types";

export function addWarning(warnings: string[], message: string) {
  if (warnings.indexOf(message) < 0) warnings.push(message);
}

export function progress(
  options: ExportOptions,
  data: Parameters<NonNullable<ExportOptions["onProgress"]>>[0],
) {
  if (options.onProgress) options.onProgress(data);
}
