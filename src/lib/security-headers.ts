// Enforce low-risk restrictions now. Resource restrictions remain report-only
// until browser verification covers all participant/admin flows.
export const enforcedCsp =
  "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";
export const reportOnlyCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "frame-src 'self' blob:",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");
