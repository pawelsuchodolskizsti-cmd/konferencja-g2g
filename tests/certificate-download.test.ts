import { beforeEach, expect, test, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { AppError } from "../src/server/errors";
vi.mock("../src/server/auth", () => ({
  requireParticipant: vi.fn(),
  limit: vi.fn(),
  requestOrigin: vi.fn(),
}));
vi.mock("../src/server/certificates", () => ({ generateCertificate: vi.fn() }));
vi.mock("../src/server/training", () => ({ participantCourses: vi.fn() }));
vi.mock("../src/server/surveys", () => ({
  participantSurvey: vi.fn(),
  submitSurvey: vi.fn(),
}));
import { requireParticipant, limit } from "../src/server/auth";
import { generateCertificate } from "../src/server/certificates";
import { GET } from "../src/app/api/participant/[action]/route";
const context = () => ({ params: Promise.resolve({ action: "certificate" }) });
beforeEach(() => {
  vi.resetAllMocks();
});

test("large certificate streams all bytes for the authenticated participant", async () => {
  vi.mocked(requireParticipant).mockResolvedValue({
    id: "current-person",
  } as Awaited<ReturnType<typeof requireParticipant>>);
  const pdf = randomBytes(6 * 1024 * 1024 + 123);
  vi.mocked(generateCertificate).mockResolvedValue({ pdf, number: "test" });
  const response = await GET(
    new Request(
      "http://localhost/api/participant/certificate?participantId=other-person",
    ),
    context(),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("application/pdf");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(generateCertificate).toHaveBeenCalledWith("current-person");
  expect(limit).toHaveBeenCalledWith("pdf:current-person", 10, 60);
  const reader = response.body!.getReader();
  const hash = createHash("sha256");
  let size = 0;
  let chunks = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    expect(value.length).toBeLessThanOrEqual(64 * 1024);
    hash.update(value);
    size += value.length;
    chunks++;
  }
  expect(chunks).toBeGreaterThan(1);
  expect(size).toBe(pdf.length);
  expect(hash.digest("hex")).toBe(
    createHash("sha256").update(pdf).digest("hex"),
  );
});

test("anonymous requests never generate a certificate", async () => {
  vi.mocked(requireParticipant).mockRejectedValue(
    new AppError(401, "Zaloguj się."),
  );
  expect(
    (
      await GET(
        new Request("http://localhost/api/participant/certificate"),
        context(),
      )
    ).status,
  ).toBe(401);
  expect(generateCertificate).not.toHaveBeenCalled();
});

test("unavailable certificates return an error before streaming starts", async () => {
  vi.mocked(requireParticipant).mockResolvedValue({
    id: "current-person",
  } as Awaited<ReturnType<typeof requireParticipant>>);
  vi.mocked(generateCertificate).mockRejectedValue(
    new AppError(403, "Certyfikat niedostępny."),
  );
  const response = await GET(
    new Request("http://localhost/api/participant/certificate"),
    context(),
  );
  expect(response.status).toBe(403);
  expect(response.headers.get("Content-Type")).toContain("application/json");
});
