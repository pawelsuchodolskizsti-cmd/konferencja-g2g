import { definitionFor } from "./survey-definition";

type ResponseRow = { questions: string[]; answers: string[] };

// Read the original labels saved with each response, including older forms.
export function surveyExportRows(
  questions: string[],
  responses: ResponseRow[],
): string[][] {
  const headers: string[] = [];
  const add = (title: string) => {
    if (!headers.includes(title)) headers.push(title);
  };
  const column = (question: string, row: string) => `${question} - ${row}`;
  for (const q of definitionFor(questions)) {
    if (q.kind === "matrix")
      q.rows!.forEach((row) => add(column(q.title, row)));
    else add(q.title);
  }
  const records = responses.map((response) => {
    const values = new Map<string, string>();
    definitionFor(response.questions).forEach((q, index) => {
      const answer = response.answers[index] ?? "";
      if (q.kind === "matrix") {
        const lines = answer.split(/\r?\n/);
        const parsed = lines.map((line) => {
          const row = q.rows!.find((label) => line.startsWith(label + ": "));
          return row ? { row, value: line.slice(row.length + 2) } : null;
        });
        if (
          answer &&
          parsed.every((item) => item !== null) &&
          new Set(parsed.map((item) => item!.row)).size === parsed.length
        ) {
          parsed.forEach((item) => {
            const title = column(q.title, item!.row);
            add(title);
            values.set(title, item!.value);
          });
        } else if (answer) {
          // Never silently drop an unrecognized historical response.
          const title = q.title + " - odpowiedź źródłowa";
          add(title);
          values.set(title, answer);
        }
      } else {
        add(q.title);
        values.set(q.title, answer);
      }
    });
    return values;
  });
  return [
    headers,
    ...records.map((values) => headers.map((title) => values.get(title) ?? "")),
  ];
}
