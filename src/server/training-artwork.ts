import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

export function isOnMyWayCourse(url: string) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      ["onmyway.pl", "www.onmyway.pl"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

let artwork: Promise<string> | undefined;
export function onMyWayArtwork() {
  // Embed only inside the authorized participant page: the image contains a code.
  return (artwork ??= readFile(
    path.join(process.cwd(), "assets/on-my-way.jpeg"),
  )
    .then((bytes) => `data:image/jpeg;base64,${bytes.toString("base64")}`)
    .catch((error) => {
      artwork = undefined;
      throw error;
    }));
}
