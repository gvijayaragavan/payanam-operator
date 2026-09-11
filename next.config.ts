// import type { NextConfig } from "next";

// const nextConfig: NextConfig = {
//   /* config options here */
// };

// export default nextConfig;

/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV === 'development'

const nextConfig = {
  ...(isDev ? {} : { output: 'export', trailingSlash: true }),
  distDir: isDev ? '.next-dev' : '.next',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  turbopack: {},
}

export default nextConfig
