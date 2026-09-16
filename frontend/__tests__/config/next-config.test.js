import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const configUrl = pathToFileURL(path.resolve(__dirname, "../../next.config.mjs")).href;
const inspectConfig = (authApiBaseUrl) => {
  const environment = authApiBaseUrl === undefined ? {} : { BASE_URL: authApiBaseUrl };
  const script = `
    const { default: config } = await import(${JSON.stringify(configUrl)});
    const rewrites = typeof config.rewrites === "function" ? await config.rewrites() : [];
    const headers = typeof config.headers === "function" ? await config.headers() : [];
    process.stdout.write(JSON.stringify({ headers, rewrites }));
  `;

  return spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    env: environment,
  });
};

test.each([
  "http://localhost:3008",
  "http://localhost:3008/",
])("proxies only same-origin auth, inquiry-review, management, and compliance-case paths to the configured backend origin: %s", (authApiBaseUrl) => {
  const result = inspectConfig(authApiBaseUrl);

  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    headers: [{ source: "/travel-rule/shared", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }],
    rewrites: [
    {
      destination: "http://localhost:3008/auth/:path*",
      source: "/auth/:path*",
    },
    {
      destination: "http://localhost:3008/travel-rule/trp/inquiries",
      source: "/travel-rule/trp/inquiries",
    },
    {
      destination: "http://localhost:3008/travel-rule/trp/inquiries/:path*",
      source: "/travel-rule/trp/inquiries/:path*",
    },
    {
      destination: "http://localhost:3008/travel-rule/trp/management",
      source: "/travel-rule/trp/management",
    },
    {
      destination: "http://localhost:3008/travel-rule/trp/management/:path*",
      source: "/travel-rule/trp/management/:path*",
    },
    {
      destination: "http://localhost:3008/travel-rule/trp/email-access/consume",
      source: "/travel-rule/trp/email-access/consume",
    },
    {
      destination: "http://localhost:3008/travel-rule/v1/cases",
      source: "/travel-rule/v1/cases",
    },
    {
      destination: "http://localhost:3008/travel-rule/v1/cases/:path*",
      source: "/travel-rule/v1/cases/:path*",
    },
    ],
  });
});

test.each([
  "ftp://localhost:3008",
  "http://user:password@localhost:3008",
  "http://localhost:3008/api",
  "http://localhost:3008/.",
  "http://localhost:3008/..",
  "http://localhost:3008/%2e",
  "http://localhost:3008?mode=dev",
  "http://localhost:3008#auth",
])("rejects a non-origin BASE_URL value: %s", (authApiBaseUrl) => {
  const result = inspectConfig(authApiBaseUrl);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("BASE_URL");
});

test("keeps rewrites disabled when BASE_URL is not configured", () => {
  const result = inspectConfig();

  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    headers: [{ source: "/travel-rule/shared", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }],
    rewrites: [],
  });
});
