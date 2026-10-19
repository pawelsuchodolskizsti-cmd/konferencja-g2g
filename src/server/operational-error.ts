// Never log query text, parameters, credentials or participant data.
export function operationalError(operation: string, error: unknown) {
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current !== "object") break;
    const item = current as { code?: unknown; cause?: unknown };
    if (typeof item.code === "string" && /^[A-Z0-9_]{2,48}$/.test(item.code))
      codes.push(item.code);
    current = item.cause;
  }
  console.error(JSON.stringify({ operation, codes, type: error instanceof Error ? error.name : "unknown" }));
}
