import "server-only";
import { mailAddresses } from "@/lib/mail-recipients";
import { connect, type TLSSocket } from "node:tls";
import {
  makeMessage,
  validAddress,
  validateSmtpResponse,
  SmtpFailure,
  smtpQueueId,
  type SmtpStage,
} from "./smtp-message";
import { createInterface } from "node:readline";
import { type MailPayload } from "@/db/schema";

// Połączenie TLS od początku (SMTPS/465), bez dopuszczania niezaszyfrowanego SMTP.
const HOST = "serwer1758522.home.pl";
const PORT = 465;
const LOGIN = "konferencja@oneday.com.pl";

async function secureSocket(): Promise<TLSSocket> {
  return await new Promise((resolve, reject) => {
    const socket = connect({
      host: HOST,
      port: PORT,
      servername: HOST,
      rejectUnauthorized: true,
    });
    const timeout = setTimeout(
      () => socket.destroy(new Error("SMTP timeout")),
      15000,
    );
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

async function smtpSession(
  password: string,
  payload?: MailPayload,
  messageId?: string,
): Promise<{ queueId: string | null }> {
  if (!password) throw new Error("Brak hasła SMTP.");
  const message = payload ? makeMessage(payload, messageId) : null;
  let socket: TLSSocket;
  try {
    socket = await secureSocket();
  } catch {
    throw new SmtpFailure("CONNECT");
  }
  let stage: SmtpStage = "GREETING";
  let accepted = false;
  let queueId: string | null = null;
  socket.setTimeout(30000, () => socket.destroy(new Error("SMTP timeout")));
  socket.on("error", () => {
    /* obsługa rozłączenia podczas odczytu */
  });
  const lines = createInterface({ input: socket, crlfDelay: Infinity });
  const reader = lines[Symbol.asyncIterator]();
  async function response(expected: number[]) {
    for (;;) {
      const next = await reader.next();
      if (next.done) throw new SmtpFailure(stage);
      const line = next.value;
      if (!/^\d{3}[ -]/.test(line)) throw new SmtpFailure(stage);
      if (line[3] === " ") {
        validateSmtpResponse(line, expected, stage);
        return line;
      }
    }
  }
  function command(line: string) {
    socket.write(line + "\r\n");
  }
  try {
    await response([220]);
    stage = "EHLO";
    command("EHLO konferencja.oneday.com.pl");
    await response([250]);
    stage = "AUTH";
    command("AUTH LOGIN");
    await response([334]);
    command(Buffer.from(LOGIN).toString("base64"));
    await response([334]);
    command(Buffer.from(password).toString("base64"));
    await response([235]);
    if (payload && message) {
      stage = "FROM";
      command(`MAIL FROM:<${LOGIN}>`);
      await response([250]);
      stage = "RECIPIENT";
      for (const address of mailAddresses(payload)) {
        command(`RCPT TO:<${validAddress(address)}>`);
        await response([250, 251]);
      }
      stage = "DATA";
      command("DATA");
      await response([354]);
      stage = "ACCEPTANCE";
      socket.write(message + "\r\n.\r\n");
      queueId = smtpQueueId(await response([250]));
      accepted = true;
    }
    stage = "QUIT";
    command("QUIT");
    await response([221]);
  } catch (error) {
    if (!accepted)
      throw error instanceof SmtpFailure ? error : new SmtpFailure(stage);
    // DATA 250 is definitive acceptance; QUIT failures must not trigger a resend.
  } finally {
    lines.close();
    socket.destroy();
  }
  return { queueId };
}

export async function sendSmtp(
  payload: MailPayload,
  password: string,
  messageId?: string,
) {
  return smtpSession(password, payload, messageId);
}
export async function verifySmtp(password: string) {
  // Tylko EHLO i uwierzytelnienie. Bez MAIL FROM, RCPT TO i DATA.
  await smtpSession(password);
}
