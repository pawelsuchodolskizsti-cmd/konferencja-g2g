import { randomUUID } from "node:crypto";

type Payload = {
  from: string;
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: string; content_id?: string }[];
};
export type SmtpStage =
  | "CONNECT"
  | "GREETING"
  | "EHLO"
  | "AUTH"
  | "FROM"
  | "RECIPIENT"
  | "DATA"
  | "ACCEPTANCE"
  | "QUIT";
export class SmtpFailure extends Error {
  constructor(
    public stage: SmtpStage,
    public smtpCode?: number,
    public enhancedCode?: string,
  ) {
    super("SMTP_" + stage + (smtpCode ? "_" + smtpCode : "_CONNECTION"));
  }
}
export function smtpDiagnostic(error: unknown): string {
  if (!(error instanceof SmtpFailure)) return "REVIEW_REQUIRED";
  return error.message + (error.enhancedCode ? "_" + error.enhancedCode : "");
}
export function smtpRetryDelay(
  error: unknown,
  attempts: number,
): number | null {
  if (!(error instanceof SmtpFailure) || attempts >= 3) return null;
  // Explicit temporary rejection means the server did not accept the message.
  if (error.smtpCode && error.smtpCode >= 400 && error.smtpCode < 500)
    return attempts * 60000;
  // A disconnect before the body is sent is also safe to retry. Once DATA has
  // been written, a lost response may hide acceptance: never retry that case.
  if (
    !error.smtpCode &&
    ["CONNECT", "GREETING", "EHLO", "FROM", "RECIPIENT", "DATA"].includes(
      error.stage,
    )
  )
    return attempts * 60000;
  return null;
}
export function validateSmtpResponse(
  line: string,
  expected: number[],
  stage: SmtpStage,
) {
  const code = Number(line.slice(0, 3));
  if (!/^\d{3} /.test(line) || !expected.includes(code)) {
    throw new SmtpFailure(
      stage,
      /^\d{3} /.test(line) ? code : undefined,
      line.match(/^\d{3} ([245]\.\d{1,3}\.\d{1,3})(?:\s|$)/)?.[1],
    );
  }
}
export function validAddress(value: string) {
  if (!/^[^\s<>@\r\n]+@[^\s<>@\r\n]+\.[^\s<>@\r\n]+$/.test(value))
    throw new Error("Nieprawidłowy adres pocztowy.");
  return value;
}
function mimeHeader(value: string) {
  const chunks: string[] = [];
  let chunk = "";
  for (const char of value.replace(/[\r\n]+/g, " ")) {
    if (Buffer.byteLength(chunk + char, "utf8") > 42) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) chunks.push(chunk);
  return chunks
    .map((part) => "=?UTF-8?B?" + Buffer.from(part).toString("base64") + "?=")
    .join("\r\n ");
}
function base64Lines(value: string | Buffer) {
  return (
    Buffer.from(value)
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") || ""
  );
}
export function htmlToText(html: string) {
  return html
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(
      /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_, url: string, label: string) =>
        label === url ? url : `${label} (${url})`,
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li)>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(amp|lt|gt|quot|apos|#39|nbsp);/g,
      (_, entity: string) =>
        ({
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
          "#39": "'",
          nbsp: " ",
        })[entity] || "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
// Keep only a bounded queue token, never the raw SMTP reply (which may contain PII).
export function smtpQueueId(reply: string) {
  return (
    reply.match(/^250\b.*\bqueued as ([a-zA-Z0-9_-]{1,100})(?:\s|$)/i)?.[1] ??
    null
  );
}
export function makeMessage(
  payload: Payload,
  messageId = "<" + randomUUID() + "@oneday.com.pl>",
) {
  validAddress(payload.to);
  if (payload.from.toLowerCase() !== "konferencja@oneday.com.pl")
    throw new Error("Adres nadawcy musi odpowiadać skonfigurowanej skrzynce.");
  if (!/^<[a-zA-Z0-9._-]+@oneday\.com\.pl>$/.test(messageId))
    throw new Error("Nieprawidłowy identyfikator wiadomości.");
  const alternative = "alternative-" + randomUUID();
  const mixed = "mixed-" + randomUUID();
  const attachments = payload.attachments || [];
  const parts = [
    "From: Fundacja One Day <konferencja@oneday.com.pl>",
    "Reply-To: konferencja@oneday.com.pl",
    "To: " + payload.to,
    "Subject: " + mimeHeader(payload.subject),
    "Date: " + new Date().toUTCString(),
    "Message-ID: " + messageId,
    "MIME-Version: 1.0",
    "Auto-Submitted: auto-generated",
    "Content-Type: multipart/" +
      (attachments.length
        ? 'mixed; boundary="' + mixed
        : 'alternative; boundary="' + alternative) +
      '"',
    "",
  ];
  if (attachments.length)
    parts.push(
      "--" + mixed,
      'Content-Type: multipart/alternative; boundary="' + alternative + '"',
      "",
    );
  for (const [type, body] of [
    ["plain", htmlToText(payload.html)],
    ["html", payload.html],
  ]) {
    parts.push(
      "--" + alternative,
      "Content-Type: text/" + type + '; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(body),
    );
  }
  parts.push("--" + alternative + "--", "");
  for (const file of attachments) {
    const filename = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    parts.push(
      "--" + mixed,
      'Content-Type: application/octet-stream; name="' + filename + '"',
      "Content-Transfer-Encoding: base64",
      'Content-Disposition: attachment; filename="' + filename + '"',
      ...(file.content_id
        ? [
            "Content-ID: <" +
              file.content_id.replace(/[^a-zA-Z0-9_-]/g, "") +
              ">",
          ]
        : []),
      "",
      base64Lines(Buffer.from(file.content, "base64")),
    );
  }
  if (attachments.length) parts.push("--" + mixed + "--", "");
  return parts.join("\r\n").replace(/(^|\r\n)\./g, "$1..");
}
