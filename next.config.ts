import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "assetmatrixenergy.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "www.assetmatrixenergy.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
