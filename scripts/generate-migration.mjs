import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "../src/db/schema.ts";
import { readFile, writeFile } from "node:fs/promises";
const journal = JSON.parse(
  await readFile("drizzle/meta/_journal.json", "utf8"),
);
const index = journal.entries.length;
const previous = JSON.parse(
  await readFile(
    `drizzle/meta/${String(index - 1).padStart(4, "0")}_snapshot.json`,
    "utf8",
  ),
);
const snapshot = generateDrizzleJson(schema, previous.id);
const statements = await generateMigration(previous, snapshot);
if (!statements.length) {
  console.log("Brak zmian schematu.");
  process.exit(0);
}
const prefix = String(index).padStart(4, "0");
const tag = `${prefix}_schema`;
await writeFile(
  `drizzle/${tag}.sql`,
  statements.join("\n--> statement-breakpoint\n"),
);
await writeFile(
  `drizzle/meta/${prefix}_snapshot.json`,
  JSON.stringify(snapshot, null, 2),
);
journal.entries.push({
  idx: index,
  version: "7",
  when: Date.now(),
  tag,
  breakpoints: true,
});
await writeFile("drizzle/meta/_journal.json", JSON.stringify(journal, null, 2));
console.log(`Migracja ${tag}: ${statements.length} instrukcji.`);
