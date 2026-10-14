/** Text of a caught value: the message of an `Error`, anything else as a string. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
