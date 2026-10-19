import "server-only";
import { connect, type TLSSocket } from "node:tls";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { type MailPayload } from "@/db/schema";

// Połączenie TLS od początku (SMTPS/465), bez dopuszczania niezaszyfrowanego SMTP.
const HOST = "serwer1758522.home.pl";
const PORT = 465;
const LOGIN = "konferencja@oneday.com.pl";

function validAddress(value: string) {
  if (!/^[^\s<>@\r\n]+@[^\s<>@\r\n]+\.[^\s<>@\r\n]+$/.test(value)) {
    throw new Error("Nieprawidłowy adres pocztowy.");
  }
  return value;
}
function mimeHeader(value: string) {
  return `=?UTF-8?B?${Buffer.from(value.replace(/[\r\n]+/g, " "), "utf8").toString("base64")}?=`;
}
function base64Lines(data: Buffer | string) {
  const encoded = Buffer.isBuffer(data) ? data.toString("base64") : Buffer.from(data, "utf8").toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") || "";
}
function makeMessage(payload: MailPayload) {
  validAddress(payload.to);
  if (payload.from.toLowerCase() !== LOGIN) {
    throw new Error("Adres nadawcy musi odpowiadać skonfigurowanej skrzynce.");
  }
  const boundary = `conference-${randomUUID()}`;
  const parts = [
    `From: ${LOGIN}`,
    `To: ${payload.to}`,
    `Subject: ${mimeHeader(payload.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/related; boundary="${boundary}"`,
    "Auto-Submitted: auto-generated",
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(payload.html),
  ];
  for (const file of payload.attachments || []) {
    const filename = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    parts.push(
      `--${boundary}`,
      `Content-Type: application/octet-stream; name="${filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: inline; filename="${filename}"`,
      ...(file.content_id ? [`Content-ID: <${file.content_id.replace(/[^a-zA-Z0-9_-]/g, "")}>`] : []),
      "",
      base64Lines(Buffer.from(file.content, "base64")),
    );
  }
  parts.push(`--${boundary}--`, "");
  // RFC 5321: dot-stuffing zabezpiecza przed przedwczesnym zakończeniem DATA.
  return parts.join("\r\n").replace(/(^|\r\n)\./g, "$1..");
}
async function secureSocket(): Promise<TLSSocket> {
  return await new Promise((resolve, reject) => {
    const socket = connect({ host: HOST, port: PORT, servername: HOST, rejectUnauthorized: true });
    const timeout = setTimeout(() => socket.destroy(new Error("SMTP timeout")), 15000);
    socket.once("secureConnect", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function smtpSession(password: string, payload?: MailPayload): Promise<void> {
  if (!password) throw new Error("Brak hasła SMTP.");
  const message = payload ? makeMessage(payload) : null;
  const socket = await secureSocket();
  socket.setTimeout(30000, () => socket.destroy(new Error("SMTP timeout")));
  socket.on("error", () => { /* obsługa rozłączenia podczas odczytu */ });
  const lines = createInterface({ input: socket, crlfDelay: Infinity });
  const reader = lines[Symbol.asyncIterator]();
  async function response(expected: number) {
    let code = 0;
    for (;;) {
      const next = await reader.next();
      if (next.done) throw new Error("Połączenie SMTP zostało przerwane.");
      const line = next.value;
      if (!/^\d{3}[ -]/.test(line)) throw new Error("Nieprawidłowa odpowiedź SMTP.");
      code = Number(line.slice(0, 3));
      if (line[3] === " ") break;
    }
    if (code !== expected) throw new Error(`Serwer SMTP odrzucił operację (kod ${code}).`);
  }
  function command(line: string) { socket.write(line + "\r\n"); }
  try {
    await response(220);
    command("EHLO konferencja.oneday.com.pl");
    await response(250);
    command("AUTH LOGIN");
    await response(334);
    command(Buffer.from(LOGIN).toString("base64"));
    await response(334);
    command(Buffer.from(password).toString("base64"));
    await response(235);
    if (payload && message) {
      command(`MAIL FROM:<${LOGIN}>`);
      await response(250);
      command(`RCPT TO:<${validAddress(payload.to)}>`);
      await response(250);
      command("DATA");
      await response(354);
      socket.write(message + "\r\n.\r\n");
      await response(250);
    }
    command("QUIT");
    await response(221);
  } finally {
    lines.close();
    socket.destroy();
  }
}

export async function sendSmtp(payload: MailPayload, password: string) {
  await smtpSession(password, payload);
}
export async function verifySmtp(password: string) {
  // Tylko EHLO i uwierzytelnienie. Bez MAIL FROM, RCPT TO i DATA.
  await smtpSession(password);
}
