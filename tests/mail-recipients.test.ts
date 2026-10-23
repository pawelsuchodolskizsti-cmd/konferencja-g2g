import { expect, test } from "vitest";
import {
  participantMailRecipients,
  mailAddresses,
} from "../src/lib/mail-recipients";
test("optional secondary address is normalized and duplicates are removed", () => {
  expect(participantMailRecipients({ email: "first@example.org" })).toEqual({
    to: "first@example.org",
  });
  expect(
    participantMailRecipients({
      email: "FIRST@example.org",
      secondaryEmail: "first@example.org",
    }),
  ).toEqual({ to: "first@example.org" });
  expect(
    mailAddresses(
      participantMailRecipients({
        email: "first@example.org",
        secondaryEmail: "SECOND@example.org",
      }),
    ),
  ).toEqual(["first@example.org", "second@example.org"]);
});
