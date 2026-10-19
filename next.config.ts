import type { NextConfig } from "next";
const config: NextConfig = {
  experimental: {
    workerThreads: true,
    webpackBuildWorker: false,
    useTypeScriptCli: false,
    cpus: 2,
  },
  serverExternalPackages: ["postgres", "@pdf-lib/fontkit"],
  outputFileTracingIncludes: {
    "/*": [
      "./assets/NotoSans-Regular.ttf",
      "./assets/invitation-background.jpg",
      "./assets/certificate-template.pdf",
      "./assets/ClashDisplay-Semibold.ttf",
      "./public/branding/montserrat-bold.ttf",
      "./public/branding/g2g-horizontal.png",
      "./public/branding/g2g-vertical.png",
    ],
  },
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
      {
        source: "/branding/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/branding/perf/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};
export default config;
