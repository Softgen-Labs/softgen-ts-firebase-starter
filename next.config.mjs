/** @type {import('next').NextConfig} */
import path from 'path';

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    turbo: {
      rules: {
        '*.tsx': {
          loaders: [path.resolve('./loaders/visual-editor-loader.js')],
          as: '*.tsx',
        },
        '*.jsx': {
          loaders: [path.resolve('./loaders/visual-editor-loader.js')],
          as: '*.jsx',
        },
      },
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  allowedDevOrigins: ['*.daytona.work', '*.localhost', '*.softgen.dev'],
};

export default nextConfig;
