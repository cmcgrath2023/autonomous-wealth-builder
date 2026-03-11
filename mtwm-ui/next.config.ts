import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["three", "@heroui/react"],
  turbopack: {},
};

export default nextConfig;
