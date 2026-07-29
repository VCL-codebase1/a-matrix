import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
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
