import { expect, test } from "vitest";
import { surveyExportRows } from "../src/lib/survey-export";
import {
  surveyDefinition,
  definitionFor,
  formatAnswer,
  emptyAnswer,
} from "../src/lib/survey-definition";
const questions = surveyDefinition.map((q) => q.title);
test("empty export already includes all seven matrix columns", () => {
  const [headers] = surveyExportRows(questions, []);
  expect(headers).toHaveLength(15);
  expect(headers.slice(2, 9)).toEqual(
    surveyDefinition[2].rows!.map((row) => `${questions[2]} - ${row}`),
  );
});
test("historical labels and removed subpoints survive alongside current answers", () => {
  const oldQuestions = [...questions, "Hotel", "Powód"];
  const old = definitionFor(oldQuestions)[2];
  const oldAnswers = oldQuestions.map(() => "");
  oldAnswers[2] = formatAnswer(old, {
    ...emptyAnswer(),
    ratings: old.rows!.map((_, i) => String(i + 1)),
  });
  oldAnswers[9] = "Tak";
  const [headers, row] = surveyExportRows(questions, [
    { questions: oldQuestions, answers: oldAnswers },
  ]);
  old.rows!.forEach((label, i) =>
    expect(row[headers.indexOf(`${questions[2]} - ${label}`)]).toBe(
      String(i + 1),
    ),
  );
  expect(row[headers.indexOf("Hotel")]).toBe("Tak");
  expect(
    row[headers.indexOf(`${questions[2]} - ${surveyDefinition[2].rows![0]}`)],
  ).toBe("");
});
test("unrecognized historical answer is retained without guessed ratings", () => {
  const answers = questions.map(() => "");
  answers[2] = "Nietypowa wcześniejsza odpowiedź";
  const [headers, row] = surveyExportRows(questions, [{ questions, answers }]);
  expect(row[headers.indexOf(questions[2] + " - odpowiedź źródłowa")]).toBe(
    answers[2],
  );
  expect(row.slice(2, 9)).toEqual(Array(7).fill(""));
});
