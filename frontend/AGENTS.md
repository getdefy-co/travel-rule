# Frontend Agent Guidance

Read [`../AGENTS.md`](../AGENTS.md) before editing this application. The repository-level file contains the canonical frontend conventions, test requirements, security boundaries, and commands.

The Docker frontend is a Next.js standalone server behind the loopback gateway at `http://localhost:3000`. Its application routes are public `/login`, authenticated `/`, and exact-`admin` `/users`. Browser Auth calls under `/auth/*` (including exact-admin `/auth/manage/*`) and JWT inquiry-review calls under `/travel-rule/trp/inquiries*` stay same-origin; do not add a public API URL environment variable. Native development may configure the same restricted Next.js server-side proxy with `BASE_URL`. API-key orchestration paths remain internal.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
