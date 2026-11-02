import type { NextConfig } from "next";

/**
 * The browser stays on yieldai.app in production: the main app rewrites /agent
 * to this deployment. fetch("/api/...") then hits the main app directly.
 *
 * This rewrite covers local dev and a direct open of this deployment, where
 * there is no main app on the same origin. basePath: false so /api is not
 * prefixed with /agent.
 *
 * Stripping the main app's admin cookie on the way through the production
 * rewrite is the main app's job, not this one's.
 */
const nextConfig: NextConfig = {
  basePath: "/agent",
  async redirects() {
    // The app only exists under /agent. Opening the deployment root
    // (localhost:3000 or the Vercel hostname) would otherwise 404.
    return [
      {
        source: "/",
        destination: "/agent",
        basePath: false,
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: "https://yieldai.app/api/:path*",
          basePath: false,
        },
      ],
    };
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "pino-pretty": false,
    };
    return config;
  },
};

export default nextConfig;
