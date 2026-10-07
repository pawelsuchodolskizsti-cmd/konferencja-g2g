import { describe, expect, it } from "vitest";
import { programStatus } from "../src/components/program-status";

const items = [
  { start: "09:00", end: "09:50", title: "Rejestracja", speaker: "" },
  { start: "10:00", end: "10:30", title: "Otwarcie", speaker: "" },
  { start: "10:30", end: "11:20", title: "Wystąpienie", speaker: "" },
];
const status = (now: string) =>
  programStatus(items, "2026-10-27T09:00:00Z", "Europe/Warsaw", new Date(now));
describe("aktualny i następny punkt programu", () => {
  it("przed dniem wydarzenia pokazuje pierwszy punkt jako następny", () => {
    expect(status("2026-10-26T09:10:00Z")).toMatchObject({
      state: "before",
      current: undefined,
      next: items[0],
    });
  });
  it("uwzględnia rejestrację przed oficjalnym rozpoczęciem i czas Warszawy", () => {
    expect(status("2026-10-27T08:10:00Z")).toMatchObject({
      state: "during",
      current: items[0],
      next: items[1],
    });
  });
  it("obsługuje lukę między punktami", () => {
    expect(status("2026-10-27T08:55:00Z")).toMatchObject({
      state: "gap",
      current: undefined,
      next: items[1],
    });
  });
  it("na granicy godzin przełącza aktualny punkt bez nakładania", () => {
    expect(status("2026-10-27T09:30:00Z")).toMatchObject({
      state: "during",
      current: items[2],
      next: undefined,
    });
  });
  it("po ostatnim punkcie i kolejnego dnia nie powtarza programu", () => {
    for (const now of ["2026-10-27T10:20:00Z", "2026-10-28T08:10:00Z"])
      expect(status(now)).toMatchObject({
        state: "after",
        current: undefined,
        next: undefined,
      });
  });
});
