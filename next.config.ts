import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = dirname(fileURLToPath(import.meta.url));

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() || "";
const isStaticExport = process.env.NEXT_STATIC_EXPORT === "true";
const distDir = process.env.FORTIS_NEXT_DIST_DIR?.trim() || undefined;
const nextConfig: NextConfig = {
  distDir,
  turbopack: {
    root: frontendRoot,
  },
  output: isStaticExport ? "export" : undefined,
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  images: {
    unoptimized: true,
  },
  basePath,
  assetPrefix: basePath || undefined,
  async headers() {
    return [
      {
        source: "/models/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/drone-defense/:path*",
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

export default nextConfig;
