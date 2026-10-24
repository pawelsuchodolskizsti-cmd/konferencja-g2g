// Enforced in production and in the production-build E2E suite.
// Inline styles and Next.js bootstrap scripts remain compatible; inline event
// handlers, foreign resource origins, framing and object embedding are blocked.
export const enforcedCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "script-src-attr 'none'",
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
