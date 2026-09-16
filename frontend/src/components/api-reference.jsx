"use client";

import { ChevronDown, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ENDPOINT_GROUPS = [
  {
    endpoints: [
      ["POST", "/travel-rule/v1/transfers", "backend:3002", "X-API-Key · transfers:write", "202 / 200 replay", "createV1Transfer"],
      ["GET", "/travel-rule/v1/transfers/:id", "backend:3002", "X-API-Key · transfers:read", "200", "getV1Transfer"],
      ["POST", "/travel-rule/v1/transfers/:id/information", "backend:3002", "X-API-Key · transfers:write", "200", "completeInformation"],
      ["POST", "/travel-rule/v1/transfers/:id/cancel", "backend:3002", "X-API-Key · transfers:write", "200", "cancelV1Transfer"],
      ["POST", "/travel-rule/v1/transfers/:id/settlement", "backend:3002", "X-API-Key · transfers:write", "202", "settleV1Transfer"],
      ["POST", "/travel-rule/v1/counterparties/preflight", "backend:3002", "X-API-Key · transfers:read", "200", "preflight"],
      ["POST", "/travel-rule/v1/webhook-subscriptions", "backend:3002", "X-API-Key · webhooks:manage", "201", "createWebhook"],
      ["GET", "/travel-rule/v1/webhook-subscriptions", "backend:3002", "X-API-Key · webhooks:manage", "200", "listWebhooks"],
      ["DELETE", "/travel-rule/v1/webhook-subscriptions/:id", "backend:3002", "X-API-Key · webhooks:manage", "204", "disableWebhook"],
    ],
    key: "v1Integration",
  },
  {
    endpoints: [
      ["GET", "/travel-rule/v1/cases", "Gateway / backend:3002", "JWT/OIDC", "200", "listCases"],
      ["GET", "/travel-rule/v1/cases/:id", "Gateway / backend:3002", "JWT/OIDC", "200", "getCase"],
      ["POST", "/travel-rule/v1/cases/:id/decisions", "Gateway / backend:3002", "JWT/OIDC · decision role", "200", "decideCase"],
      ["GET", "/travel-rule/v1/cases/:id/audit", "Gateway / backend:3002", "JWT/OIDC", "200", "auditCase"],
      ["POST", "/travel-rule/v1/encryption/reencryption-jobs", "backend:3002", "Admin JWT/OIDC", "202", "createReencryption"],
      ["GET", "/travel-rule/v1/encryption/reencryption-jobs", "backend:3002", "Admin JWT/OIDC", "200", "listReencryption"],
    ],
    key: "compliance",
  },
  {
    endpoints: [
      ["POST", "/travel-rule/trp/travel-addresses", "backend:3002", "X-API-Key · transfers:write", "201", "createTravelAddress"],
      ["POST", "/travel-rule/trp/transfers", "backend:3002", "X-API-Key · transfers:write", "200 / 202", "createTrpTransfer"],
      ["GET", "/travel-rule/trp/transfers/:id", "backend:3002", "X-API-Key · transfers:read", "200", "getTrpTransfer"],
      ["POST", "/travel-rule/trp/transfers/:id/confirm", "backend:3002", "X-API-Key · transfers:write", "200 / 202", "confirmTrpTransfer"],
      ["POST", "/travel-rule/trp/transfers/:id/retry", "backend:3002", "X-API-Key · transfers:write", "200 / 202", "retryTrpTransfer"],
    ],
    key: "trpCompatibility",
  },
  {
    endpoints: [
      ["GET", "/travel-rule/trp/inquiries", "Gateway / backend:3002", "JWT/OIDC", "200", "listInquiries"],
      ["GET", "/travel-rule/trp/inquiries/:id", "Gateway / backend:3002", "JWT/OIDC", "200", "getInquiry"],
      ["POST", "/travel-rule/trp/inquiries/:id/decision", "Gateway / backend:3002", "JWT/OIDC", "200 / 202", "decideInquiry"],
      ["GET", "/travel-rule/trp/management/analytics", "Gateway / backend:3002", "JWT/OIDC", "200", "analytics"],
      ["GET", "/travel-rule/trp/management/transfers", "Gateway / backend:3002", "JWT/OIDC", "200", "listManagementResource"],
      ["GET", "/travel-rule/trp/management/transfers/:id", "Gateway / backend:3002", "JWT/OIDC", "200", "getManagementResource"],
      ["GET", "/travel-rule/trp/management/messages", "Gateway / backend:3002", "JWT/OIDC", "200", "listManagementResource"],
      ["GET", "/travel-rule/trp/management/messages/:id", "Gateway / backend:3002", "JWT/OIDC", "200", "getManagementResource"],
      ["GET", "/travel-rule/trp/management/tokens", "Gateway / backend:3002", "JWT/OIDC", "200", "listManagementResource"],
      ["GET", "/travel-rule/trp/management/tokens/:id", "Gateway / backend:3002", "JWT/OIDC", "200", "getManagementResource"],
      ["GET", "/travel-rule/trp/management/events", "Gateway / backend:3002", "JWT/OIDC", "200", "listManagementResource"],
      ["GET", "/travel-rule/trp/management/events/:id", "Gateway / backend:3002", "JWT/OIDC", "200", "getManagementResource"],
      ["POST", "/travel-rule/trp/management/travel-addresses", "Gateway / backend:3002", "Admin JWT/OIDC", "201", "managementTravelAddress"],
      ["POST", "/travel-rule/trp/management/transfers", "Gateway / backend:3002", "Admin JWT/OIDC", "200 / 202", "managementTransfer"],
      ["POST", "/travel-rule/trp/management/transfers/:id/confirm", "Gateway / backend:3002", "Admin JWT/OIDC", "200 / 202", "managementConfirm"],
      ["POST", "/travel-rule/trp/management/transfers/:id/retry", "Gateway / backend:3002", "Admin JWT/OIDC", "200 / 202", "managementRetry"],
      ["POST", "/travel-rule/trp/management/transfers/:id/email-invitations", "Gateway / backend:3002", "Admin JWT/OIDC", "202", "createEmailInvitation"],
      ["GET", "/travel-rule/trp/management/emails", "Gateway / backend:3002", "Admin JWT/OIDC", "200", "listEmailDeliveries"],
      ["POST", "/travel-rule/trp/management/emails/:id/retry", "Gateway / backend:3002", "Admin JWT/OIDC", "202", "retryEmailDelivery"],
      ["POST", "/travel-rule/trp/email-access/consume", "Gateway / backend:3002", "Public · rate limited", "200 / 410", "consumeEmailAccess"],
    ],
    key: "operator",
  },
  {
    endpoints: [
      ["GET", "/", "Public TLS :3001", "Public", "200", "serviceStatus"],
      ["GET", "/health/live", "Public TLS :3001", "Public", "200", "liveness"],
      ["GET", "/health/ready", "Public TLS :3001", "Public", "200 / 503", "readiness"],
      ["GET", "/identity", "Public TLS :3001", "Public", "200", "identity"],
      ["POST", "/travel-rule/trp/protocol/inquiries/:token", "Public TLS :3001", "mTLS + TRP headers", "200", "protocolInquiry"],
      ["POST", "/travel-rule/trp/protocol/resolutions/:token", "Public TLS :3001", "mTLS + TRP headers", "204", "protocolResolution"],
      ["POST", "/travel-rule/trp/protocol/confirmations/:token", "Public TLS :3001", "mTLS + TRP headers", "204", "protocolConfirmation"],
    ],
    key: "publicPeer",
  },
];

export const httpMethodBadgeVariant = (method) => {
  if (method === "DELETE") return "danger";
  if (method === "GET") return "info";
  if (method === "PUT") return "warning";
  return "success";
};

export function ApiReference() {
  const { t } = useTranslation();
  const [activeGroup, setActiveGroup] = useState("all");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredGroups = ENDPOINT_GROUPS.map((group) => {
    if (activeGroup !== "all" && activeGroup !== group.key) return { ...group, endpoints: [] };
    const endpoints = group.endpoints.filter(([method, path, listener, authentication, , descriptionKey]) => {
      const description = t(`common:apiDocs.endpointDescriptions.${descriptionKey}`);
      return [method, path, listener, authentication, description].join(" ").toLowerCase().includes(normalizedQuery);
    });
    return { ...group, endpoints };
  }).filter((group) => group.endpoints.length > 0);
  const resultCount = filteredGroups.reduce((total, group) => total + group.endpoints.length, 0);

  return (
    <section aria-label={t("common:apiDocs.reference.contentLabel")} className="flex flex-1 flex-col gap-8 p-4 md:p-8">
      <header className="max-w-4xl space-y-5">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight md:text-4xl">
            {t("common:apiDocs.reference.title")}
          </h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">{t("common:apiDocs.reference.description")}</p>
        </div>
      </header>

      <div className="space-y-4 rounded-xl border bg-muted/20 p-4 md:p-5">
        <label className="block space-y-2" htmlFor="api-reference-search">
          <span className="text-sm font-medium">{t("common:apiDocs.reference.searchLabel")}</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              id="api-reference-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("common:apiDocs.reference.searchPlaceholder")}
              type="search"
              value={query}
            />
          </span>
        </label>
        <div aria-label={t("common:apiDocs.reference.filtersLabel")} className="flex flex-wrap gap-2" role="group">
          <Button aria-pressed={activeGroup === "all"} onClick={() => setActiveGroup("all")} size="sm" type="button" variant={activeGroup === "all" ? "default" : "outline"}>
            {t("common:apiDocs.reference.allGroups")}
          </Button>
          {ENDPOINT_GROUPS.map((group) => (
            <Button
              aria-pressed={activeGroup === group.key}
              key={group.key}
              onClick={() => setActiveGroup(group.key)}
              size="sm"
              type="button"
              variant={activeGroup === group.key ? "default" : "outline"}
            >
              {t(`common:apiDocs.reference.groups.${group.key}.title`)}
            </Button>
          ))}
        </div>
        <p aria-live="polite" className="text-sm text-muted-foreground" role="status">
          {t("common:apiDocs.reference.resultCount", { count: resultCount })}
        </p>
      </div>

      {resultCount === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("common:apiDocs.reference.noResults")}</div>
      ) : (
        <div className="space-y-8">
          {filteredGroups.map((group) => (
            <section aria-labelledby={`api-reference-${group.key}`} className="space-y-3" key={group.key}>
              <div>
                <h2 className="text-xl font-semibold tracking-tight" id={`api-reference-${group.key}`}>
                  {t(`common:apiDocs.reference.groups.${group.key}.title`)}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{t(`common:apiDocs.reference.groups.${group.key}.description`)}</p>
              </div>
              <div className="space-y-2">
                {group.endpoints.map(([method, path, listener, authentication, success, descriptionKey]) => (
                  <details aria-label={`${method} ${path}`} className="group overflow-hidden rounded-lg border bg-card" key={`${method}-${path}`}>
                    <summary className="flex cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden">
                      <Badge className="mt-0.5 shrink-0" variant={httpMethodBadgeVariant(method)}>
                        {method}
                      </Badge>
                      <code className="min-w-0 flex-1 break-all text-sm font-semibold">{path}</code>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{success}</span>
                      <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="space-y-4 border-t bg-muted/20 p-4">
                      <dl className="grid gap-4 text-sm sm:grid-cols-3">
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("common:apiDocs.reference.listener")}</dt>
                          <dd className="mt-1">{listener}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("common:apiDocs.reference.authentication")}</dt>
                          <dd className="mt-1">{authentication}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("common:apiDocs.reference.success")}</dt>
                          <dd className="mt-1 font-mono">{success}</dd>
                        </div>
                      </dl>
                      <div>
                        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("common:apiDocs.reference.behavior")}</h3>
                        <p className="mt-1 text-sm leading-6">{t(`common:apiDocs.endpointDescriptions.${descriptionKey}`)}</p>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
