// Clash Display Semibold, Indian Type Foundry (Fontshare).
// Source and license: https://www.fontshare.com/fonts/clash-display
// Download directly instead of redistributing the font in the repository.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const file = new URL("../assets/ClashDisplay-Semibold.ttf", import.meta.url);
const sha256 = "77d8cfd143551af67e599b7d74f9ab51da33c77b149971e241c84647d2d33cd3";
const valid = (data) => createHash("sha256").update(data).digest("hex") === sha256;
let cached;
try { cached = await readFile(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (!cached || !valid(cached)) {
  const response = await fetch("https://cdn.fontshare.com/wf/FPDAZ2S6SW4QMSRIIKNNGTPM6VIXYMKO/5HNPQ453FRLIQWV2FNOBUU3FKTDZQVSG/Z3MGHFHX6DCTLQ55LJYRJ5MDCZPMFZU6.ttf", { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Fontshare font download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes)) throw new Error("Clash Display font checksum mismatch");
  await mkdir(new URL("../assets/", import.meta.url), { recursive: true });
  await writeFile(file, bytes);
}
