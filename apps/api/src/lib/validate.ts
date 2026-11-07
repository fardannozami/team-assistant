import { HttpError } from "./http-error.js";

type ParseResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { issues: { path: (string | number)[]; message: string }[] };
    };

type Parser<T> = { safeParse: (data: unknown) => ParseResult<T> };

export function parseWith<T>(schema: Parser<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => {
        const path = issue.path.join(".") || "body";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    throw new HttpError(400, message);
  }
  return result.data;
}
