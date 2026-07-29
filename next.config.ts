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
      {
        protocol: "https",
        hostname: "a-matrix.ng",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "www.a-matrix.ng",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
