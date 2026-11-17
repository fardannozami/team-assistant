export function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23503"
  );
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
}

// Postgres rejecting a value's format or range: a non-UUID id, an impossible
// date, a negative LIMIT. These come from the request, so they are a 400.
const BAD_INPUT_CODES = new Set(["22P02", "22007", "22008", "22003", "2201W", "2201X"]);

export function isBadInputError(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } } | null);
  return BAD_INPUT_CODES.has(code?.code ?? "") || BAD_INPUT_CODES.has(code?.cause?.code ?? "");
}
