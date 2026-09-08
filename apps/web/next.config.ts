import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
  poweredByHeader: false,
  serverExternalPackages: ["postgres"],
  outputFileTracingExcludes: {
    "/*": [
      "../../data/**",
      "../../library/**",
      "../../artifacts/**",
      "../../config/**",
      "../../.env*",
      "../../.secrets/**",
      "../../backups/**",
      "../../model-cache/**",
      "../../master.key",
      "../../secrets.enc.json",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default nextConfig;
