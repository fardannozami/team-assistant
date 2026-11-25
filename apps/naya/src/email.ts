/** Splits "Subjek: …" (first line) from the body of an email template the AI wrote. */
export function splitEmail(text: string): { subject: string; body: string } {
  const match = /^\s*(?:subjek|subject)\s*:\s*(.*)\r?\n/i.exec(text)
  return match ? { subject: match[1].trim(), body: text.slice(match[0].length).replace(/^\s*\n/, '').trimEnd() } : { subject: '', body: text.trimEnd() }
}
