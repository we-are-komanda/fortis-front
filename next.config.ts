import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = dirname(fileURLToPath(import.meta.url));

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() || "";
const isStaticExport = process.env.NEXT_STATIC_EXPORT === "true";
const isDesktop = process.env.FORTIS_DESKTOP_BUILD === "true";
const distDir = process.env.FORTIS_NEXT_DIST_DIR?.trim() || undefined;
const nextConfig: NextConfig = {
  distDir,
  turbopack: {
    root: isDesktop ? dirname(frontendRoot) : frontendRoot,
  },
  output: isDesktop ? "standalone" : isStaticExport ? "export" : undefined,
  outputFileTracingRoot: isDesktop ? dirname(frontendRoot) : undefined,
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  images: {
    unoptimized: true,
  },
  basePath,
  assetPrefix: basePath || undefined,
  async headers() {
    return [
      ...(isDesktop ? [{ source: "/:path*", headers: [
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tiles.openfreemap.org https://tile.openstreetmap.org https://tile.opentopomap.org https://tiles.api-maps.yandex.ru; font-src 'self' data:; connect-src 'self' blob: data: https://tiles.openfreemap.org https://tile.openstreetmap.org https://tile.opentopomap.org https://tiles.api-maps.yandex.ru; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'" },
      ] }] : []),
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
