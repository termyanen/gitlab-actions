import { TextMergeError, validateMergeText } from "./merge-contract";

function isNativeFunction(
  value: unknown,
): value is (...args: number[]) => unknown {
  return typeof value === "function";
}

function numberResult(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new TextMergeError("CP_MERGE_FAILED", "Invalid native merge result");
  return value;
}

/** Fresh instance per operation owns all native memory, released after the call. */
export function mergeWithModule(
  module: WebAssembly.Module,
  parent: string,
  source: string,
  target: string,
): string {
  validateMergeText(parent, source, target);
  if (parent === target || source === target) return source;
  if (parent === source) return target;
  const instance = new WebAssembly.Instance(module, {});
  const { memory, malloc, merge_files, result_ptr, result_size, _initialize } =
    instance.exports;
  if (
    !(memory instanceof WebAssembly.Memory) ||
    !isNativeFunction(malloc) ||
    !isNativeFunction(merge_files) ||
    !isNativeFunction(result_ptr) ||
    !isNativeFunction(result_size) ||
    !isNativeFunction(_initialize)
  )
    throw new TextMergeError("CP_MERGE_FAILED", "Invalid native merge exports");
  _initialize();
  const encoder = new TextEncoder();
  const inputs = [parent, target, source].map((text) => {
    const bytes = encoder.encode(text);
    const pointer = numberResult(malloc(Math.max(1, bytes.length)));
    if (pointer <= 0)
      throw new TextMergeError(
        "CP_WORK_LIMIT",
        "Native merge memory limit exceeded",
      );
    new Uint8Array(memory.buffer, pointer, bytes.length).set(bytes);
    return { pointer, length: bytes.length };
  });
  const [base, ours, theirs] = inputs;
  if (!base || !ours || !theirs)
    throw new TextMergeError("CP_MERGE_FAILED", "Missing native merge inputs");
  const status = numberResult(
    merge_files(
      base.pointer,
      base.length,
      ours.pointer,
      ours.length,
      theirs.pointer,
      theirs.length,
    ),
  );
  if (status > 0)
    throw new TextMergeError("CP_OVERLAP", "Overlapping text changes");
  if (status < 0)
    throw new TextMergeError("CP_MERGE_FAILED", "Native merge failed");
  const pointer = numberResult(result_ptr());
  const length = numberResult(result_size());
  if (pointer < 0 || length < 0 || pointer + length > memory.buffer.byteLength)
    throw new TextMergeError("CP_MERGE_FAILED", "Invalid native merge output");
  return new TextDecoder("utf-8", { fatal: true }).decode(
    new Uint8Array(memory.buffer, pointer, length),
  );
}
