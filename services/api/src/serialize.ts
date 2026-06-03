/** Recursively convert bigint values to strings for JSON responses. */
export function serializeForJson<T>(payload: T): T {
  return JSON.parse(
    JSON.stringify(payload, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  ) as T;
}
