import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  images: { unoptimized: true },
  allowedDevOrigins: [
    'app.homelabai.org',
    'homelabai.org',
  ],
};

export default nextConfig;
