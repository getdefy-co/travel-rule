import { fileURLToPath } from "node:url";

const parseAuthApiBaseUrl = (value) => {
  if (value === undefined || value === "") {
    return null;
  }

  if (!/^https?:\/\/[^/?#\s]+\/?$/i.test(value)) {
    throw new Error("BASE_URL must be an HTTP(S) origin without credentials, path, query, or fragment.");
  }

  let parsed;

  try {
    parsed = new URL(value);
  } catch (_error) {
    throw new Error("BASE_URL must be an HTTP(S) origin without credentials, path, query, or fragment.");
  }

  if (
    !["http:", "https:"].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("BASE_URL must be an HTTP(S) origin without credentials, path, query, or fragment.");
  }

  return parsed.origin;
};

const authApiBaseUrl = parseAuthApiBaseUrl(process.env.BASE_URL);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: false,
  headers() {
    return [{
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      source: "/travel-rule/shared",
    }];
  },
  rewrites() {
    if (!authApiBaseUrl) {
      return [];
    }

    return [
      {
        destination: `${authApiBaseUrl}/auth/:path*`,
        source: "/auth/:path*",
      },
      {
        destination: `${authApiBaseUrl}/travel-rule/trp/inquiries`,
        source: "/travel-rule/trp/inquiries",
      },
      {
        destination: `${authApiBaseUrl}/travel-rule/trp/inquiries/:path*`,
        source: "/travel-rule/trp/inquiries/:path*",
      },
      {
        destination: `${authApiBaseUrl}/travel-rule/trp/management`,
        source: "/travel-rule/trp/management",
      },
      {
        destination: `${authApiBaseUrl}/travel-rule/trp/management/:path*`,
        source: "/travel-rule/trp/management/:path*",
      },
      {
        destination: `${authApiBaseUrl}/travel-rule/trp/email-access/consume`,
        source: "/travel-rule/trp/email-access/consume",
      },
      {
        destination: `${authApiBaseUrl}/travel-rule/v1/cases`,
        source: "/travel-rule/v1/cases",
      },
      {
        destination: `${authApiBaseUrl}/travel-rule/v1/cases/:path*`,
        source: "/travel-rule/v1/cases/:path*",
      },
    ];
  },
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
};

export default nextConfig;
