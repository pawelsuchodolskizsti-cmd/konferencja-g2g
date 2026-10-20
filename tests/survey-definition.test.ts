import { expect, test } from "vitest";
import {
  surveyDefinition as q,
  emptyAnswer,
  answerError,
  formatAnswer,
} from "../src/lib/survey-definition";
test("validates single choice, optional text, matrix and maximum two choices", () => {
  expect(
    answerError(q[0], { ...emptyAnswer(), selected: ["fałszywa opcja"] }),
  ).toBeTruthy();
  expect(
    answerError(q[0], {
      ...emptyAnswer(),
      selected: q[0].options!.slice(0, 2),
    }),
  ).toBeTruthy();
  expect(answerError(q[8], emptyAnswer())).toBeNull();
  expect(answerError(q[4], emptyAnswer())).toBeTruthy();
  expect(
    answerError(q[3], {
      ...emptyAnswer(),
      selected: q[3].options!.slice(0, 3),
    }),
  ).toBeTruthy();
  expect(
    answerError(q[3], {
      ...emptyAnswer(),
      selected: [q[3].options![0], "Żadna."],
    }),
  ).toBeTruthy();
  expect(
    answerError(q[5], { ...emptyAnswer(), selected: ["Inny obszar."] }),
  ).toBeTruthy();
  expect(
    answerError(q[5], {
      ...emptyAnswer(),
      selected: ["Inny obszar."],
      text: "Wsparcie rodzin",
    }),
  ).toBeNull();
  expect(
    answerError(q[2], {
      ...emptyAnswer(),
      ratings: Array(6).fill(q[2].options![4]),
    }),
  ).toBeTruthy();
  const matrix = { ...emptyAnswer(), ratings: Array(7).fill(q[2].options![4]) };
  expect(answerError(q[2], matrix)).toBeNull();
  expect(formatAnswer(q[2], matrix).split("\n")).toHaveLength(7);
});

test("current survey has nine questions without hotel or trust item", () => {
  expect(q).toHaveLength(9);
  expect(q[2].rows).toHaveLength(7);
  expect(JSON.stringify(q)).not.toMatch(/Presidential|zaufanie do Fundacji/);
});
