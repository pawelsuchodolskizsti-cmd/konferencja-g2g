export type EventPermission = "ADMIN" | "CHECKIN" | "READ";
// Explicit allowlist: even GET certificate issuance is a write operation.
export function adminPermission(
  method: string,
  path: string[],
): EventPermission {
  const action = path[2];
  if (["checkin", "checkin-people"].includes(action)) return "CHECKIN";
  if (
    ["GET", "POST"].includes(method) &&
    path.length === 3 &&
    ["export", "codes-export", "reports"].includes(action)
  )
    return "READ";
  if (method === "GET") {
    if (path.length === 2) return "READ";
    if (
      path.length === 3 &&
      [
        "survey",
        "survey-export",
        "survey-summary",
        "privacy",
        "history",
        "invitation",
        "program-qr",
      ].includes(action)
    )
      return "READ";
    if (action === "materials" && path.length === 4) return "READ";
    if (action === "participants" && path.length === 5 && path[4] === "data")
      return "READ";
  }
  return "ADMIN";
}
