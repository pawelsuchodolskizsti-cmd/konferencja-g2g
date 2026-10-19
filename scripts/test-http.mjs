import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { unzipSync } from "fflate";
import * as XLSX from "xlsx";
import { PARTICIPANT_PRIVACY_VERSION } from "../src/lib/participant-privacy.ts";
import { decrypt } from "../src/server/crypto.ts";
import { PDFDocument } from "pdf-lib";
process.loadEnvFile(".env.local");
assert.equal(process.env.APP_ENV, "development");
assert.equal(new URL(process.env.APP_URL).hostname, "localhost");
assert.equal(new URL(process.env.DATABASE_URL).hostname, "127.0.0.1");
const origin = process.env.APP_URL;
const access = JSON.parse(await readFile(".local/access.json", "utf8"));
let cookie = "";
let pcookie = "";
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const checks = [];
async function call(
  path,
  {
    method = "GET",
    body,
    auth = cookie,
    expected = 200,
    requestOrigin = origin,
  } = {},
) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(auth ? { cookie: auth } : {}),
      ...(method === "GET" ? {} : { origin: requestOrigin }),
      ...(body instanceof FormData
        ? {}
        : { "content-type": "application/json" }),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  if (response.status !== expected)
    throw Error(
      `${method} ${path}: expected ${expected}, received ${response.status}: ${await response.text()}`,
    );
  return response;
}
async function checked(name, fn) {
  await fn();
  checks.push(name);
  console.log(`OK: ${name}`);
}
try {
  await checked("anonim nie ma dostępu do panelu ani certyfikatu", async () => {
    await call("/api/admin/events", { auth: "", expected: 401 });
    await call("/api/participant/certificate", { auth: "", expected: 401 });
  });
  await checked("logowanie i ochrona Origin", async () => {
    await call("/api/auth/admin", {
      method: "POST",
      body: access,
      auth: "",
      requestOrigin: "https://other.example.org",
      expected: 403,
    });
    const r = await call("/api/auth/admin", {
      method: "POST",
      body: access,
      auth: "",
    });
    cookie = r.headers.get("set-cookie").split(";")[0];
  });
  const list = await (await call("/api/admin/events")).json();
  let eventId = list[0]?.id;
  if (!eventId) {
    const event = await (
      await call("/api/admin/events/setup", {
        method: "POST",
        expected: 201,
        body: {
          name: "Konferencja testowa",
          slug: `test-${Date.now()}`,
          organizer: "Fundacja Testowa",
          location: "Sala konferencyjna",
          startsAt: "2020-01-01T09:00:00Z",
          endsAt: "2020-01-01T17:00:00Z",
          certificateUnlockAt: "2020-01-01T17:00:00Z",
          timezone: "Europe/Warsaw",
          mailFrom: "test@example.org",
          mailSubject: "Zaproszenie {{firstName}}",
          mailBody:
            "Cześć {{firstName}}, {{eventName}}. Twój kod: {{accessCode}}",
          published: true,
          info: "Dane testowe",
          retentionUntil: null,
          agenda: [
            {
              start: "09:00",
              end: "10:00",
              title: "Otwarcie konferencji",
              speaker: "Organizator",
            },
          ],
        },
      })
    ).json();
    eventId = event.id;
  }
  const base = `/api/admin/events/${eventId}`;
  await checked(
    "podgląd i zatwierdzenie 251 osób, walidacja 2 błędów",
    async () => {
      const rows = [
        ["Imię", "Nazwisko", "Email"],
        ...Array.from({ length: 250 }, (_, i) => [
          "Uczestnik",
          `Testowy ${String(i + 1).padStart(3, "0")}`,
          `test-${eventId}-${i}@example.org`,
        ]),
        ["Duplikat", "Test", `test-${eventId}-0@example.org`],
        ["Błędny", "Email", "brak-adresu"],
        ["", "Nazwisko", "missing@example.org"],
      ];
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet(rows),
        "Uczestnicy",
      );
      const bytes = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
      await mkdir(".local/fixtures", { recursive: true });
      await writeFile(".local/fixtures/participants.xlsx", bytes);
      const form = new FormData();
      form.set("file", new File([bytes], "participants.xlsx"));
      const preview = await (
        await call(`${base}/import`, { method: "POST", body: form })
      ).json();
      if (preview.valid === 251) {
        assert.equal(preview.total, 253);
        const commit = await (
          await call(`${base}/import-confirm`, {
            method: "POST",
            body: { batchId: preview.id },
          })
        ).json();
        assert.equal(commit.imported, 251);
        await call(`${base}/import-confirm`, {
          method: "POST",
          body: { batchId: preview.id },
          expected: 409,
        });
      } else assert.equal(preview.valid, 0);
    },
  );
  const [person] =
    await sql`SELECT * FROM participants WHERE event_id=${eventId} ORDER BY email LIMIT 1`;
  const credentials = JSON.parse(decrypt(person.credentials));
  await checked("brak logowania przed potwierdzeniem obecności", async () => {
    const existing =
      await sql`SELECT * FROM attendance WHERE participant_id=${person.id}`;
    if (!existing.length)
      await call("/api/auth/participant", {
        auth: "",
        method: "POST",
        expected: 403,
        body: {
          privacyAcknowledged: true,
          privacyVersion: PARTICIPANT_PRIVACY_VERSION,
          code: credentials.accessCode,
        },
      });
  });
  await checked(
    "QR: powtórne i równoległe skanowanie bez duplikatów",
    async () => {
      const first = await (
        await call(`${base}/checkin`, {
          method: "POST",
          body: { token: credentials.qrToken },
        })
      ).json();
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          call(`${base}/checkin`, {
            method: "POST",
            body: { token: credentials.qrToken },
          }).then((r) => r.json()),
        ),
      );
      assert(
        results.every(
          (r) => r.alreadyPresent && r.checkedInAt === first.checkedInAt,
        ),
      );
      const [{ count }] =
        await sql`SELECT count(*)::int as count FROM attendance WHERE participant_id=${person.id}`;
      assert.equal(count, 1);
    },
  );
  await checked("logowanie po obecności i przyjęciu klauzuli", async () => {
    const r = await call("/api/auth/participant", {
      auth: "",
      method: "POST",
      body: {
        privacyAcknowledged: true,
        privacyVersion: PARTICIPANT_PRIVACY_VERSION,
        code: credentials.accessCode,
      },
    });
    pcookie = r.headers.get("set-cookie").split(";")[0];
  });
  let overview = await (await call(base)).json();
  if (!overview.courses.length) {
    await call(`${base}/courses`, {
      method: "POST",
      body: {
        name: "Komunikacja w fundacji",
        platform: "Akademia fundacji",
        url: "https://example.org/kurs-1",
        mode: "SHARED",
        sharedCode: "TEST-WSPOLNY",
      },
    });
    const course = await (
      await call(`${base}/courses`, {
        method: "POST",
        body: {
          name: "Zarządzanie projektem",
          platform: "Akademia fundacji",
          url: "https://example.org/kurs-2",
          mode: "INDIVIDUAL",
        },
      })
    ).json();
    const form = new FormData();
    form.set(
      "file",
      new File(
        ["Kod\nTEST-INDYWIDUALNY-001\nTEST-INDYWIDUALNY-002"],
        "codes.csv",
      ),
    );
    await call(`${base}/courses/${course.id}/codes`, {
      method: "POST",
      body: form,
    });
  }
  await checked(
    "obecny uczestnik otrzymuje dwa kursy, przydział jest stały",
    async () => {
      const one = await (
        await call("/api/participant/courses", { auth: pcookie })
      ).json();
      const two = await (
        await call("/api/participant/courses", { auth: pcookie })
      ).json();
      assert.equal(one.length, 2);
      assert(one.every((c) => c.available && c.code));
      assert.deepEqual(one, two);
    },
  );
  await checked("PDF z danymi z sesji i terminem odblokowania", async () => {
    const r = await call(
      "/api/participant/certificate?participantId=another-person",
      { auth: pcookie },
    );
    const pdf = new Uint8Array(await r.arrayBuffer());
    assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);
    await writeFile(".local/fixtures/certificate.pdf", pdf);
    const original =
      await sql`SELECT certificate_unlock_at FROM events WHERE id=${eventId}`;
    await sql`UPDATE events SET certificate_unlock_at='2099-01-01' WHERE id=${eventId}`;
    try {
      await call("/api/participant/certificate", {
        auth: pcookie,
        expected: 403,
      });
      await call("/api/participant/certificate-email", {
        auth: pcookie,
        method: "POST",
        body: {},
        expected: 410,
      });
    } finally {
      await sql`UPDATE events SET certificate_unlock_at=${original[0].certificate_unlock_at} WHERE id=${eventId}`;
    }
  });
  await checked("materiały PDF są chronione obecnością", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File(
        [await (await PDFDocument.create()).save()],
        "Materiał testowy.pdf",
      ),
    );
    const item = await (
      await call(`${base}/materials`, { method: "POST", body: form })
    ).json();
    await call(`/api/participant/materials/${item.id}`, {
      auth: "",
      expected: 401,
    });
    await call(`/api/participant/materials/${item.id}`, { auth: pcookie });
    const [absent] =
      await sql`SELECT credentials FROM participants p WHERE event_id=${eventId} AND NOT EXISTS(SELECT 1 FROM attendance a WHERE a.participant_id=p.id) LIMIT 1`;
    await call("/api/auth/participant", {
      auth: "",
      method: "POST",
      expected: 403,
      body: {
        privacyAcknowledged: true,
        privacyVersion: PARTICIPANT_PRIVACY_VERSION,
        code: JSON.parse(decrypt(absent.credentials)).accessCode,
      },
    });
    await call(`${base}/materials/${item.id}`, {
      method: "PATCH",
      body: { title: "Ukryty materiał", published: false },
    });
    await call(`/api/participant/materials/${item.id}`, {
      auth: pcookie,
      expected: 404,
    });
    await call(`${base}/materials/${item.id}`, { method: "DELETE" });
  });
  await checked("wysyłka z panelu jest wyłączona", async () => {
    await call(`${base}/mail`, { method: "POST", body: {}, expected: 410 });
    await call(`${base}/mail-preview`, { expected: 410 });
    await call("/api/cron/mail", { auth: "", expected: 401 });
  });
  await checked("eksport istniejących kodów 251 uczestników", async () => {
    await call(`${base}/codes-export`, { auth: "", expected: 401 });
    const response = await call(`${base}/codes-export`);
    const book = XLSX.read(await response.arrayBuffer());
    const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]);
    assert.equal(rows.length, 251);
    assert.equal(new Set(rows.map((row) => row.Kod)).size, 251);
    assert(rows.every((row) => /^[A-Z0-9]{6}$/.test(row.Kod)));
    const again = XLSX.read(
      await (await call(`${base}/codes-export`)).arrayBuffer(),
    );
    assert.deepEqual(
      XLSX.utils.sheet_to_json(again.Sheets[again.SheetNames[0]]),
      rows,
    );
    const csv = await (await call(`${base}/export`)).text();
    assert.equal(csv.trim().split("\r\n").length, 251);
  });
  await checked(
    "administrator nie uzyskuje dostępu do obcego wydarzenia",
    async () => {
      const id = randomUUID();
      await sql`INSERT INTO events(id,slug,name,organizer,location,starts_at,ends_at,certificate_unlock_at,mail_from) VALUES(${id},${`other-${id}`},'Inne wydarzenie','Test','Sala','2020-01-01','2020-01-02','2020-01-02','test@example.org')`;
      try {
        await call(`/api/admin/events/${id}`, { expected: 403 });
        await call(`/api/admin/events/${id}/checkin`, {
          method: "POST",
          body: { token: credentials.qrToken },
          expected: 403,
        });
      } finally {
        await sql`DELETE FROM events WHERE id=${id}`;
      }
    },
  );
  await checked(
    "nowe funkcje admina: osoba, CSV, PDF, ZIP, RODO, role",
    async () => {
      const created = await (
        await call(`${base}/participants`, {
          method: "POST",
          expected: 201,
          body: {
            firstName: "Żaneta",
            lastName: "Testowa",
            email: `qa-${randomUUID()}@example.org`,
          },
        })
      ).json();
      const id = created.id;
      try {
        const people = (await (await call(base)).json()).people;
        const p = people.find((x) => x.id === id);
        assert(p && !p.checkedInAt);
        await call(`${base}/participants/${id}/certificate`, { expected: 403 });
        const csv = await (
          await call(`${base}/codes-export?format=csv&ids=${id}`)
        ).text();
        assert.equal(csv.trim().split("\r\n").length, 2);
        const bulk = await (
          await call(`${base}/reports`, {
            method: "POST",
            body: {
              kind: "attendance",
              ids: people.map((x) => x.id).join(","),
            },
          })
        ).text();
        assert.equal(bulk.trim().split("\r\n").length, people.length + 1);
        const pdf = await (
          await call(`${base}/codes-export?format=pdf&ids=${id}`)
        ).arrayBuffer();
        assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);
        await writeFile(".local/fixtures/invitation.pdf", Buffer.from(pdf));
        const zip = unzipSync(
          new Uint8Array(
            await (
              await call(`${base}/codes-export?format=zip&ids=${id}`)
            ).arrayBuffer(),
          ),
        );
        assert.equal(
          Object.keys(zip).filter((x) => x.endsWith(".pdf")).length,
          1,
        );
        assert(Object.keys(zip).some((x) => x.endsWith(".csv")));
        const data = await (
          await call(`${base}/participants/${id}/data`)
        ).text();
        assert(
          !data.includes("credentials") &&
            !data.includes("qrToken") &&
            !data.includes(p.accessCode),
        );
        await call(`${base}/privacy`, {
          method: "POST",
          body: {
            participantId: id,
            kind: "ACCESS",
            status: "OPEN",
            note: "Test HTTP",
          },
        });
        const privacy = await (await call(`${base}/privacy`)).json();
        const request = privacy.requests.find((x) => x.participantId === id);
        assert(request);
        await call(`${base}/privacy`, {
          method: "POST",
          body: {
            id: request.id,
            participantId: id,
            kind: "ACCESS",
            status: "DONE",
            note: "Test HTTP",
          },
        });
        await call(`${base}/checkin`, {
          method: "POST",
          body: { participantId: id },
        });
        await call(`${base}/participants/${id}/undo-checkin`, {
          method: "POST",
          body: { reason: "Błędny test obecności" },
        });
        await call(`${base}/participants/${id}/reset`, {
          method: "POST",
          body: { confirmation: "ZMIEŃ KODY" },
        });
        const after = (await (await call(base)).json()).people.find(
          (x) => x.id === id,
        );
        assert.notEqual(after.accessCode, p.accessCode);
        assert(!after.checkedInAt);
        const staff = {
          email: `staff-${randomUUID()}@example.org`,
          password: randomUUID(),
          role: "CHECKIN",
        };
        await call(`${base}/team`, { method: "POST", body: staff });
        const login = await call("/api/auth/admin", {
          auth: "",
          method: "POST",
          body: staff,
        });
        const sc = login.headers.get("set-cookie").split(";")[0];
        await call(base, { auth: sc, expected: 403 });
        await call(`${base}/codes-export`, { auth: sc, expected: 403 });
        await call(`${base}/privacy`, { auth: sc, expected: 403 });
        const found = await (
          await call(
            `${base}/checkin-people?q=${encodeURIComponent(after.accessCode)}`,
            { auth: sc },
          )
        ).json();
        assert.equal(found.length, 1);
        assert(!("email" in found[0]));
        await call(`${base}/checkin`, {
          auth: sc,
          method: "POST",
          body: { participantId: id },
        });
        const member = (await (await call(`${base}/team`)).json()).find(
          (x) => x.email === staff.email,
        );
        await call(`${base}/team/${member.id}`, { method: "DELETE" });
        await call(`${base}/checkin-people?q=Test`, {
          auth: sc,
          expected: 401,
        });
        const logs = await (await call(`${base}/history?target=${id}`)).json();
        assert(logs.some((x) => x.action === "PARTICIPANT_CREATED"));
        await call(`${base}/reports?kind=privacy&ids=${id}`);
        await call(`${base}/reports?kind=certificates&ids=${id}`);
        await call(`${base}/survey-summary`);
        await call(`${base}/cleanup`, { method: "POST", body: {} });
      } finally {
        await call(`${base}/participants/${id}`, { method: "DELETE" });
      }
    },
  );
  await writeFile(
    ".local/participant-access.json",
    JSON.stringify({
      code: credentials.accessCode,
      eventId,
      participantId: person.id,
    }),
  );
  await writeFile(
    ".local/http-results.json",
    JSON.stringify({ passed: checks.length, checks }, null, 2),
  );
  console.log(`${checks.length} scenariuszy HTTP zakończonych powodzeniem.`);
} finally {
  await sql.end();
}
