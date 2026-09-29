import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
  async headers() {
    return [
      {
        // Generated media is content-stable — cache a year, skip revalidation
        // requests (each would cost bandwidth on every ad view otherwise).
        source: "/ads/:name*.mp4",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/trailer.mp4",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
