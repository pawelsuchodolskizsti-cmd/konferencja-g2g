import type { NextConfig } from "next";
const config: NextConfig = {
  experimental: {
    workerThreads: true,
    webpackBuildWorker: false,
    useTypeScriptCli: false,
    cpus: 2,
  },
  serverExternalPackages: ["postgres", "@pdf-lib/fontkit"],
  outputFileTracingIncludes: { "/*": ["./assets/*", "./public/branding/*"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};
export default config;
