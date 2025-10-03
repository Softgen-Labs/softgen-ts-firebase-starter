/** @type {import('next').NextConfig} */
import path from 'path';

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    turbo: {
      rules: {
        '*.tsx': {
          loaders: [path.resolve('./loaders/visual-editor-loader.mjs')],
          as: '*.tsx',
        },
        '*.jsx': {
          loaders: [path.resolve('./loaders/visual-editor-loader.mjs')],
          as: '*.jsx',
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
