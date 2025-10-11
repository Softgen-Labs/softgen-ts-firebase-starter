/** @type {import('next').NextConfig} */
import path from "path";

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    turbo: {
      rules: {
        "*.tsx": {
          loaders: [path.resolve("./loaders/softgen-element-tagger.mjs")],
          as: "*.tsx",
        },
        "*.jsx": {
          loaders: [path.resolve("./loaders/softgen-element-tagger.mjs")],
          as: "*.jsx",
        },
      },
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  allowedDevOrigins: ["*.daytona.work", "*.softgen.dev"],
};

export default nextConfig;
