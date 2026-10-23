import { expect, test, vi } from "vitest";
import {
  makeMessage,
  htmlToText,
  smtpDiagnostic,
  SmtpFailure,
  validateSmtpResponse,
  smtpQueueId,
  smtpRetryDelay,
} from "../src/server/smtp-message";
const scenario = vi.hoisted(() => ({
  recipient: 250,
  quitDisconnect: false,
  dataCode: 250,
  sent: 0,
  recipients: [] as string[],
  rejectedAddress: "",
}));
vi.mock("node:tls", async () => {
  const { Duplex } = await import("node:stream");
  return {
    connect: () => {
      let step = 0;
      const socket = new Duplex({
        read() {},
        write(chunk, _encoding, done) {
          const line = chunk.toString();
          let reply = "250 OK";
          if (line.startsWith("EHLO")) reply = "250-test\r\n250 AUTH LOGIN";
          else if (line.startsWith("AUTH")) {
            step = 1;
            reply = "334 username";
          } else if (step === 1) {
            step = 2;
            reply = "334 password";
          } else if (step === 2) {
            step = 0;
            reply = "235 authenticated";
          } else if (line.startsWith("RCPT")) {
            scenario.recipients.push(line);
            reply =
              (scenario.rejectedAddress &&
              line.includes(scenario.rejectedAddress)
                ? 550
                : scenario.recipient) +
              " 5.1.1 private@example.org sensitive reply";
          } else if (line === "DATA\r\n") reply = "354 continue";
          else if (line.startsWith("From:")) {
            scenario.sent++;
            reply =
              scenario.dataCode === 250
                ? "250 2.0.0 Ok: queued as ABC123"
                : scenario.dataCode + " 5.7.1 policy";
          } else if (line === "QUIT\r\n") {
            if (scenario.quitDisconnect) {
              queueMicrotask(() => socket.push(null));
              done();
              return;
            }
            reply = "221 bye";
          }
          queueMicrotask(() => socket.push(reply + "\r\n"));
          done();
        },
      });
      Object.assign(socket, { setTimeout() {} });
      queueMicrotask(() => {
        socket.emit("secureConnect");
        setTimeout(() => socket.push("220 ready\r\n"), 0);
      });
      return socket;
    },
  };
});
import { sendSmtp } from "../src/server/smtp-transport";
const payload = {
  from: "konferencja@oneday.com.pl",
  to: "test@example.org",
  subject: "Zaproszenie: Łódź",
  html: '<p>Cześć Łukasz &amp; Ewa</p><p>Kod: TEST</p><a href="https://example.org/uczestnik">Panel</a>',
};

test("both recipients are accepted before a single message is submitted", async () => {
  scenario.recipient = 250;
  scenario.recipients = [];
  scenario.sent = 0;
  await sendSmtp({ ...payload, cc: "second@example.org" }, "synthetic");
  expect(scenario.recipients).toEqual([
    "RCPT TO:<test@example.org>\r\n",
    "RCPT TO:<second@example.org>\r\n",
  ]);
  expect(scenario.sent).toBe(1);
  expect(makeMessage({ ...payload, cc: "second@example.org" })).toContain(
    "Cc: second@example.org",
  );
});

test("second recipient rejection sends no body to either recipient", async () => {
  scenario.recipient = 250;
  scenario.rejectedAddress = "second@example.org";
  scenario.sent = 0;
  try {
    await expect(
      sendSmtp({ ...payload, cc: "second@example.org" }, "synthetic"),
    ).rejects.toMatchObject({ stage: "RECIPIENT", smtpCode: 550 });
    expect(scenario.sent).toBe(0);
  } finally {
    scenario.rejectedAddress = "";
  }
});
test("multipart alternative contains readable plain text and original HTML with valid metadata", () => {
  const mail = makeMessage(payload, "<invitation-test@oneday.com.pl>");
  expect(mail).toContain("Content-Type: multipart/alternative;");
  expect(mail).not.toContain("multipart/related");
  expect(mail).toContain("Date:");
  expect(mail).toContain("Message-ID: <invitation-test@oneday.com.pl>");
  expect(mail).toContain('Content-Type: text/plain; charset="UTF-8"');
  expect(mail).toContain('Content-Type: text/html; charset="UTF-8"');
  expect(mail).toContain(
    Buffer.from(payload.html).toString("base64").slice(0, 76),
  );
  expect(htmlToText(payload.html)).toContain("Cześć Łukasz & Ewa");
  expect(htmlToText(payload.html)).toContain(
    "Panel (https://example.org/uczestnik)",
  );
});
test("long unicode subjects are folded without broken characters or header injection", () => {
  const subject = "Zażółć gęślą ".repeat(30) + "\r\nBcc: unwanted@example.org";
  const mail = makeMessage({ ...payload, subject });
  const encoded = mail.match(/=\?UTF-8\?B\?[^?]+\?=/g)!;
  expect(encoded.every((word) => word.length <= 75)).toBe(true);
  expect(
    encoded
      .map((word) => Buffer.from(word.slice(10, -2), "base64").toString())
      .join(""),
  ).toBe(subject.replace(/[\r\n]+/g, " "));
  expect(mail).not.toContain("\r\nBcc:");
  expect(() =>
    makeMessage({
      ...payload,
      to: "test@example.org\r\nBcc: injected@example.org",
    }),
  ).toThrow();
});
test("attachments preserve alternative bodies inside multipart mixed", () => {
  const mail = makeMessage({
    ...payload,
    attachments: [
      { filename: "test.pdf", content: Buffer.from("PDF").toString("base64") },
    ],
  });
  expect(mail).toContain("multipart/mixed");
  expect(mail).toContain("multipart/alternative");
  expect(mail).toContain(
    'Content-Disposition: attachment; filename="test.pdf"',
  );
});
test("diagnostics keep stage and codes but never raw replies or secrets", () => {
  let failure: unknown;
  try {
    validateSmtpResponse(
      "550 5.1.1 private@example.org secret",
      [250, 251],
      "RECIPIENT",
    );
  } catch (e) {
    failure = e;
  }
  expect(smtpDiagnostic(failure)).toBe("SMTP_RECIPIENT_550_5.1.1");
  expect(smtpDiagnostic(new Error("password=secret"))).toBe("REVIEW_REQUIRED");
  expect(smtpDiagnostic(new SmtpFailure("CONNECT"))).toBe(
    "SMTP_CONNECT_CONNECTION",
  );
});
test("only definite non-acceptance is retried, with a strict attempt limit", () => {
  expect(smtpRetryDelay(new SmtpFailure("CONNECT"), 1)).toBe(60000);
  expect(smtpRetryDelay(new SmtpFailure("RECIPIENT", 450), 2)).toBe(120000);
  expect(smtpRetryDelay(new SmtpFailure("ACCEPTANCE", 451), 1)).toBe(60000);
  expect(smtpRetryDelay(new SmtpFailure("ACCEPTANCE"), 1)).toBeNull();
  expect(smtpRetryDelay(new SmtpFailure("RECIPIENT", 550), 1)).toBeNull();
  expect(smtpRetryDelay(new SmtpFailure("AUTH", 535), 1)).toBeNull();
  expect(smtpRetryDelay(new SmtpFailure("CONNECT"), 3)).toBeNull();
  expect(smtpRetryDelay(new Error("unknown"), 1)).toBeNull();
});
test("accepted DATA remains successful if QUIT disconnects, and RCPT 251 is accepted", async () => {
  scenario.recipient = 251;
  scenario.quitDisconnect = true;
  scenario.dataCode = 250;
  scenario.sent = 0;
  await expect(sendSmtp(payload, "synthetic-password")).resolves.toEqual({
    queueId: "ABC123",
  });
  expect(scenario.sent).toBe(1);
});
test("queue receipt extracts only an ID and plain text does not repeat visible URLs", () => {
  expect(smtpQueueId("250 2.0.0 Ok: queued as ABC123")).toBe("ABC123");
  expect(smtpQueueId("250 OK private@example.org")).toBeNull();
  expect(smtpQueueId("550 queued as ABC123")).toBeNull();
  expect(smtpQueueId("250 queued as private@example.org")).toBeNull();
  expect(
    htmlToText(
      '<html><head><title>hidden metadata</title></head><body><a href="https://example.org">https://example.org</a></body></html>',
    ),
  ).toBe("https://example.org");
});
test("recipient rejection stops before DATA and reports a safe error", async () => {
  scenario.recipient = 550;
  scenario.quitDisconnect = false;
  scenario.sent = 0;
  await expect(sendSmtp(payload, "synthetic-password")).rejects.toMatchObject({
    stage: "RECIPIENT",
    smtpCode: 550,
    enhancedCode: "5.1.1",
  });
  expect(scenario.sent).toBe(0);
});
test("DATA rejection is not reported as accepted", async () => {
  scenario.recipient = 250;
  scenario.dataCode = 554;
  scenario.sent = 0;
  await expect(sendSmtp(payload, "synthetic-password")).rejects.toMatchObject({
    stage: "ACCEPTANCE",
    smtpCode: 554,
  });
});
