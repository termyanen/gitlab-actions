/** User-provided IDs must not read or overwrite Object.prototype members. */
export function emptyRecord<T>(): Record<string, T> {
  const result: Record<string, T> = {};
  Object.setPrototypeOf(result, null);
  return result;
}
