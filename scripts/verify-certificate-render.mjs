import { writeFile, mkdir } from "node:fs/promises";
const { renderCertificate: before } =
  await import("../.local/load-test/certificate-pdf-before.ts");
const { renderCertificate: after } =
  await import("../src/server/certificate-pdf.ts");
const names = [
  "Anny Kowalskiej",
  "Żanety Łąckiej-Świętochowskiej",
  "Anny Marii Katarzyny Świętochowskiej-Kowalskiej-Wiśniewskiej",
];
await mkdir(".local/load-test/pdf", { recursive: true });
for (const [index, name] of names.entries()) {
  const input = {
    name,
    eventName: "GŁOWA DO GÓRY",
    organizer: "Fundacja One Day",
    date: "27 października 2026",
    number: "TEST",
  };
  await writeFile(
    `.local/load-test/pdf/before-${index}.pdf`,
    await before(input),
  );
  await writeFile(
    `.local/load-test/pdf/after-${index}.pdf`,
    await after(input),
  );
}
console.log("Prepared three before/after comparisons.");
