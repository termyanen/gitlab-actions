/** Runtime evidence for data arriving from JSON, browser messages and storage. */
export type Guard<T> = (value: unknown) => value is T;
export type Decoder<T> = (value: unknown) => T;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
export function isString(value: unknown): value is string {
  return typeof value === "string";
}
export function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}
export function isUnknown(_value: unknown): _value is unknown {
  return true;
}
export function literal<const T extends string | number | boolean>(
  expected: T,
): Guard<T> {
  return (value): value is T => value === expected;
}
export function optional<T>(guard: Guard<T>): Guard<T | undefined> {
  return (value): value is T | undefined => value === undefined || guard(value);
}
export function nullable<T>(guard: Guard<T>): Guard<T | null> {
  return (value): value is T | null => value === null || guard(value);
}
export function either<A, B>(a: Guard<A>, b: Guard<B>): Guard<A | B> {
  return (value): value is A | B => a(value) || b(value);
}
export function arrayOf<T>(guard: Guard<T>): Guard<T[]> {
  return (value): value is T[] => isUnknownArray(value) && value.every(guard);
}
export function recordOf<T>(guard: Guard<T>): Guard<Record<string, T>> {
  return (value): value is Record<string, T> =>
    isRecord(value) && Object.values(value).every(guard);
}
/** Check every declared field; unknown fields remain available for forward compatibility. */
export function objectOf<T extends object>(fields: {
  [K in keyof T]-?: Guard<T[K]>;
}): Guard<T> {
  return (value): value is T => {
    if (!isRecord(value)) return false;
    for (const key in fields) {
      if (!fields[key](value[key])) return false;
    }
    return true;
  };
}
export function decoder<T>(
  guard: Guard<T>,
  description = "API response",
): Decoder<T> {
  return (value) => {
    if (!guard(value)) throw new Error("Invalid " + description);
    return value;
  };
}
export function decodeArray<T>(read: Decoder<T>): Decoder<T[]> {
  return (value) => {
    if (!isUnknownArray(value)) throw new Error("Invalid API response list");
    return value.map(read);
  };
}
