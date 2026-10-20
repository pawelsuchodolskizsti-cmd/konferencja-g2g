import { expect, test } from "vitest";
import sharp from "sharp";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { brandingCrops, generateBrandingCrops } from "../scripts/generate-branding-crops.mjs";

test("seven individually optimized images preserve every original logo crop pixel", async () => {
  await generateBrandingCrops();
  let optimizedSize = 0;
  for (const item of brandingCrops) {
    const source = join("public", "branding", item.source);
    const output = join("public", "branding", "crops", item.name + ".webp");
    const original = await sharp(source)
      .resize(item.canvas[0], item.canvas[1], { fit: "fill", kernel: "lanczos3" })
      .extract(item.crop)
      .ensureAlpha()
      .raw()
      .toBuffer();
    const optimized = await sharp(output).ensureAlpha().raw().toBuffer();
    expect(optimized.equals(original), item.name + ": pixel mismatch").toBe(true);
    const meta = await sharp(output).metadata();
    expect([meta.width, meta.height]).toEqual([item.crop.width, item.crop.height]);
    optimizedSize += (await stat(output)).size;
  }
  const oldSize = (await stat("public/branding/organizatorzy-zrodlo.jpg")).size +
    (await stat("public/branding/partnerzy-biale-loga.png")).size;
  expect(optimizedSize).toBeLessThan(oldSize);
}, 120000);

test("visual layout remains frozen: original headings, seven individual logos and unchanged card sizes", async () => {
  const jsx = await readFile("src/app/page.tsx", "utf8");
  const css = await readFile("src/app/home.module.css", "utf8");
  expect(jsx).toContain("Organizator i patronaci");
  expect(jsx).toContain("Patronat honorowy");
  expect(jsx).toContain("Partner współzapraszający");
  expect(jsx).toContain("Partnerzy projektu");
  for (const item of brandingCrops) {
    expect(jsx).toContain("/branding/crops/" + item.name + ".webp");
  }
  expect(css).toContain("aspect-ratio: 330 / 200;");
  expect(css).toContain("aspect-ratio: 360 / 150;");
  expect(css).toContain("repeat(3, minmax(0, 1fr))");
  expect(css).toContain("repeat(4, minmax(0, 1fr))");
  expect(css).toContain("filter: url(#partner-white-alpha)");
  expect(jsx).not.toContain('src="/branding/organizatorzy-zrodlo.jpg"');
  expect(jsx).not.toContain('src="/branding/partnerzy-biale-loga.png"');
});
