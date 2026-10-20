import sharp from "sharp";
import { mkdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

// Zamrożone kadrowanie z home.module.css na dzień 2026-10-20.
// Pliki wejściowe są oryginalnymi grafikami z public/branding.
// Wycinki w skali 2x odpowiadają widokowi sprzed optymalizacji.
export const brandingCrops = [
  {
    name: "one-day",
    source: "organizatorzy-zrodlo.jpg",
    sourceSize: [2858, 1905],
    canvas: [3840, 2560],
    crop: { left: 2080, top: 1220, width: 660, height: 400 },
  },
  {
    name: "rzecznik-praw-dziecka",
    source: "organizatorzy-zrodlo.jpg",
    sourceSize: [2858, 1905],
    canvas: [3840, 2560],
    crop: { left: 2080, top: 1610, width: 660, height: 400 },
  },
  {
    name: "dla-naszych-dzieci",
    source: "organizatorzy-zrodlo.jpg",
    sourceSize: [2858, 1905],
    canvas: [3840, 2560],
    crop: { left: 2080, top: 2040, width: 660, height: 400 },
  },
  {
    name: "incredibles",
    source: "partnerzy-biale-loga.png",
    sourceSize: [1942, 809],
    canvas: [1440, 600],
    crop: { left: 0, top: 0, width: 720, height: 300 },
  },
  {
    name: "presidential-hotel",
    source: "partnerzy-biale-loga.png",
    sourceSize: [1942, 809],
    canvas: [1440, 600],
    crop: { left: 720, top: 0, width: 720, height: 300 },
  },
  {
    name: "yummy",
    source: "partnerzy-biale-loga.png",
    sourceSize: [1942, 809],
    canvas: [1440, 600],
    crop: { left: 0, top: 300, width: 720, height: 300 },
  },
  {
    name: "garnizon-sztuki",
    source: "partnerzy-biale-loga.png",
    sourceSize: [1942, 809],
    canvas: [1440, 600],
    crop: { left: 720, top: 300, width: 720, height: 300 },
  },
];

export async function generateBrandingCrops(root = process.cwd()) {
  const sourceDir = resolve(root, "public/branding");
  const destination = join(sourceDir, "crops");
  await mkdir(destination, { recursive: true });

  for (const item of brandingCrops) {
    const source = join(sourceDir, item.source);
    const metadata = await sharp(source).metadata();
    if (metadata.width !== item.sourceSize[0] || metadata.height !== item.sourceSize[1]) {
      throw new Error(`Zmieniono plik źródłowy ${item.source}; sprawdź zgodność kadrowania przed wdrożeniem.`);
    }
    const [width, height] = item.canvas;
    const output = join(destination, `${item.name}.webp`);
    await sharp(source)
      .resize(width, height, { fit: "fill", kernel: "lanczos3" })
      .extract(item.crop)
      .webp({ lossless: true, effort: 5 })
      .toFile(output);
    const { size } = await stat(output);
    console.log(`Branding crop: ${item.name}.webp (${Math.round(size / 1024)} KiB)`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await generateBrandingCrops();
}
