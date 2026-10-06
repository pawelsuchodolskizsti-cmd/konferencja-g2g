import next from "next";
import { createServer } from "node:http";
const port = Number(process.env.PORT || 3000);
const app = next({
  dev: true,
  hostname: "localhost",
  port,
  webpack: true,
});
await app.prepare();
const handler = app.getRequestHandler();
createServer((req, res) => handler(req, res)).listen(port, "127.0.0.1", () =>
  console.log(`Podgląd: http://localhost:${port}`),
);

