"use client";

import { ArrowRight, CheckCircle2, Clipboard, LockKeyhole, Network, Server } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ENVIRONMENT_CODE = `export DEFY_INTERNAL_BASE_URL=http://backend:3002
export DEFY_API_KEY='<scoped-api-key>'`;

const V1_PREFLIGHT_CODE = `curl --request POST "$DEFY_INTERNAL_BASE_URL/travel-rule/v1/counterparties/preflight" \\
  --header "X-API-Key: $DEFY_API_KEY" \\
  --header 'Content-Type: application/json' \\
  --data '{
    "connector_candidates": ["native_trp"],
    "required_capabilities": ["ivms101_exchange", "settlement_confirmation"]
  }'`;

const V1_TRANSFER_CODE = `curl --request POST "$DEFY_INTERNAL_BASE_URL/travel-rule/v1/transfers" \\
  --header "X-API-Key: $DEFY_API_KEY" \\
  --header 'Idempotency-Key: withdrawal-synthetic-001' \\
  --header 'Content-Type: application/json' \\
  --data '{
    "external_id": "withdrawal-synthetic-001",
    "direction": "outbound",
    "policy_profile": "TR-MASAK-2025",
    "asset": {
      "amount": "1000000",
      "code": "USDC",
      "network": "ethereum",
      "is_stablecoin": true,
      "dti": "4H95J0R2X"
    },
    "counterparty": {
      "type": "hosted",
      "travel_address": "<beneficiary-travel-address>"
    },
    "parties": {
      "ivms101": {
        "originator": {
          "accountNumber": ["SYNTHETIC-ORIGINATOR"],
          "originatorPersons": [{
            "naturalPerson": {
              "customerNumber": "SYNTHETIC-001",
              "geographicAddress": [{
                "addressType": "HOME",
                "addressLine": ["Synthetic Originator Street 1"],
                "townName": "Istanbul",
                "country": "TR"
              }],
              "name": {
                "nameIdentifier": [{
                  "primaryIdentifier": "Example",
                  "secondaryIdentifier": "Originator",
                  "nameIdentifierType": "LEGL"
                }]
              }
            }
          }]
        },
        "beneficiary": {
          "accountNumber": ["SYNTHETIC-BENEFICIARY"],
          "beneficiaryPersons": [{
            "legalPerson": {
              "customerNumber": "SYNTHETIC-002",
              "geographicAddress": [{
                "addressType": "GEOG",
                "addressLine": ["Synthetic Beneficiary Avenue 2"],
                "townName": "Berlin",
                "country": "DE"
              }],
              "name": {
                "nameIdentifier": [{
                  "legalPersonName": "Example Beneficiary Ltd",
                  "legalPersonNameIdentifierType": "LEGL"
                }]
              }
            }
          }]
        }
      }
    },
    "valuations": [{
      "currency": "TRY",
      "value": 10000,
      "source": "synthetic-treasury",
      "as_of": "<current-ISO-8601-timestamp>"
    }],
    "risk_signals": [],
    "connector_candidates": ["native_trp"],
    "required_capabilities": ["ivms101_exchange"],
    "description": "Synthetic customer withdrawal for integration testing"
  }'`;

const V1_WEBHOOK_CODE = `curl --request POST "$DEFY_INTERNAL_BASE_URL/travel-rule/v1/webhook-subscriptions" \\
  --header "X-API-Key: $DEFY_API_KEY" \\
  --header 'Content-Type: application/json' \\
  --data '{
    "url": "https://vasp.example/webhooks/defy",
    "event_types": ["case.action_required", "transfer.ready", "transfer.settled"],
    "secret": "<32-to-256-character-signing-secret>"
  }'`;

const TRP_ADDRESS_CODE = `curl --request POST "$DEFY_INTERNAL_BASE_URL/travel-rule/trp/travel-addresses" \\
  --header "X-API-Key: $DEFY_API_KEY" \\
  --header 'Content-Type: application/json' \\
  --data '{
    "beneficiary_reference": "synthetic-beneficiary-001",
    "ttl_seconds": 3600
  }'`;

const TRP_TRANSFER_CODE = `curl --request POST "$DEFY_INTERNAL_BASE_URL/travel-rule/trp/transfers" \\
  --header "X-API-Key: $DEFY_API_KEY" \\
  --header 'Content-Type: application/json' \\
  --data '{
    "travel_address": "<beneficiary-travel-address>",
    "asset": { "dti": "4H95J0R2X" },
    "amount": "1000000",
    "ivms101": {
      "originator": {
        "accountNumber": ["SYNTHETIC-ORIGINATOR"],
        "originatorPersons": [{
          "naturalPerson": {
            "customerNumber": "SYNTHETIC-001",
            "geographicAddress": [{
              "addressType": "HOME",
              "addressLine": ["Synthetic Originator Street 1"],
              "townName": "Istanbul",
              "country": "TR"
            }],
            "name": {
              "nameIdentifier": [{
                "primaryIdentifier": "Example",
                "secondaryIdentifier": "Originator",
                "nameIdentifierType": "LEGL"
              }]
            }
          }
        }]
      },
      "beneficiary": {
        "accountNumber": ["SYNTHETIC-BENEFICIARY"],
        "beneficiaryPersons": [{
          "legalPerson": {
            "customerNumber": "SYNTHETIC-002",
            "geographicAddress": [{
              "addressType": "GEOG",
              "addressLine": ["Synthetic Beneficiary Avenue 2"],
              "townName": "Berlin",
              "country": "DE"
            }],
            "name": {
              "nameIdentifier": [{
                "legalPersonName": "Example Beneficiary Ltd",
                "legalPersonNameIdentifierType": "LEGL"
              }]
            }
          }
        }]
      }
    }
  }'`;

const TRP_DECISION_CODE = `curl --request POST "http://localhost:3000/travel-rule/trp/inquiries/<inquiry-id>/decision" \\
  --header "Authorization: Bearer $DEFY_REVIEWER_JWT" \\
  --header 'Content-Type: application/json' \\
  --data '{
    "decision": "approved",
    "payment_address": "synthetic-payment-address"
  }'`;

const TRP_CONFIRM_CODE = `curl --request POST "$DEFY_INTERNAL_BASE_URL/travel-rule/trp/transfers/<transfer-id>/confirm" \\
  --header "X-API-Key: $DEFY_API_KEY" \\
  --header 'Content-Type: application/json' \\
  --data '{ "txid": "synthetic-transaction-reference" }'`;

const V1_STEPS = [
  { code: ENVIRONMENT_CODE, codeLabelKey: "environment", descriptionKey: "configureDescription", titleKey: "configureTitle" },
  { code: V1_PREFLIGHT_CODE, codeLabelKey: "preflight", descriptionKey: "preflightDescription", titleKey: "preflightTitle" },
  { code: V1_TRANSFER_CODE, codeLabelKey: "v1Transfer", descriptionKey: "transferDescription", titleKey: "transferTitle" },
  { descriptionKey: "stateDescription", titleKey: "stateTitle" },
  { code: V1_WEBHOOK_CODE, codeLabelKey: "webhook", descriptionKey: "webhookDescription", titleKey: "webhookTitle" },
];

const TRP_STEPS = [
  { code: ENVIRONMENT_CODE, codeLabelKey: "environment", descriptionKey: "configureDescription", titleKey: "configureTitle" },
  { code: TRP_ADDRESS_CODE, codeLabelKey: "travelAddress", descriptionKey: "addressDescription", titleKey: "addressTitle" },
  { code: TRP_TRANSFER_CODE, codeLabelKey: "trpTransfer", descriptionKey: "transferDescription", titleKey: "transferTitle" },
  { code: TRP_DECISION_CODE, codeLabelKey: "inquiryDecision", descriptionKey: "decisionDescription", titleKey: "decisionTitle" },
  { code: TRP_CONFIRM_CODE, codeLabelKey: "confirmation", descriptionKey: "confirmationDescription", titleKey: "confirmationTitle" },
];

function CodeBlock({ code, label, t }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(t("common:toasts.copied"));
    } catch {
      toast.error(t("common:toasts.copyFailed"));
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border bg-zinc-950 text-zinc-50">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2 text-xs text-zinc-400">
        <span>{label}</span>
        <Button aria-label={t("common:apiDocs.copy", { label })} className="text-zinc-200 hover:bg-zinc-800 hover:text-white" onClick={copy} size="sm" type="button" variant="ghost">
          <Clipboard />
          {t("common:apiDocs.copyAction")}
        </Button>
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-6">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Quickstart({ ariaLabel, prefix, steps, t }) {
  return (
    <section aria-label={ariaLabel} className="space-y-6 pt-4">
      <ol className="space-y-8">
        {steps.map((step, index) => {
          const label = step.codeLabelKey ? t(`common:apiDocs.codeLabels.${step.codeLabelKey}`) : null;
          return (
            <li className="relative border-l pl-8" key={step.titleKey}>
              <span className="absolute -left-4 top-0 flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{index + 1}</span>
              <div className="space-y-3">
                <div>
                  <h3 className="font-semibold">{t(`common:apiDocs.${prefix}.steps.${step.titleKey}`)}</h3>
                  <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">{t(`common:apiDocs.${prefix}.steps.${step.descriptionKey}`)}</p>
                </div>
                {step.code ? <CodeBlock code={step.code} label={label} t={t} /> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function ApiDocs() {
  const { t } = useTranslation();

  return (
    <section aria-label={t("common:apiDocs.contentLabel")} className="flex flex-1 flex-col gap-10 p-4 md:p-8">
      <header className="max-w-4xl space-y-5">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight md:text-4xl">{t("common:apiDocs.title")}</h1>
        <p className="text-base leading-7 text-muted-foreground">{t("common:apiDocs.description")}</p>
      </header>

      <Alert>
        <LockKeyhole />
        <AlertTitle>{t("common:apiDocs.boundary.title")}</AlertTitle>
        <AlertDescription className="grid gap-2 leading-6 md:grid-cols-3 md:gap-5">
          <p>{t("common:apiDocs.boundary.internal")}</p>
          <p>{t("common:apiDocs.boundary.protocol")}</p>
          <p>{t("common:apiDocs.boundary.secret")}</p>
        </AlertDescription>
      </Alert>

      <dl className="grid gap-4 md:grid-cols-3">
        {[
          [Server, "baseUrl", "backend:3002"],
          [LockKeyhole, "authentication", "X-API-Key"],
          [Network, "protocolMode", "PROTOCOL=TRP"],
        ].map(([Icon, labelKey, value]) => (
          <div className="rounded-lg border p-4" key={labelKey}>
            <dt className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon className="size-4" />
              {t(`common:apiDocs.boundary.${labelKey}`)}
            </dt>
            <dd className="mt-2 font-mono text-sm font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="quickstart-title" className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight" id="quickstart-title">
            {t("common:apiDocs.quickstartTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("common:apiDocs.quickstartDescription")}</p>
        </div>
        <Tabs defaultValue="v1">
          <TabsList aria-label={t("common:apiDocs.integrationPathLabel")} className="max-w-full overflow-x-auto" variant="line">
            <TabsTrigger value="v1">
              <CheckCircle2 />
              {t("common:apiDocs.v1.tab")}
            </TabsTrigger>
            <TabsTrigger value="trp">
              <Network />
              {t("common:apiDocs.trp.tab")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="v1">
            <Quickstart ariaLabel={t("common:apiDocs.v1.contentLabel")} prefix="v1" steps={V1_STEPS} t={t} />
          </TabsContent>
          <TabsContent value="trp">
            <Quickstart ariaLabel={t("common:apiDocs.trp.contentLabel")} prefix="trp" steps={TRP_STEPS} t={t} />
          </TabsContent>
        </Tabs>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-5 md:flex-row md:items-center md:justify-between" aria-labelledby="reference-cta-title">
        <div>
          <h2 className="text-lg font-semibold" id="reference-cta-title">
            {t("common:apiDocs.referenceCta.title")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{t("common:apiDocs.referenceCta.description")}</p>
        </div>
        <Button asChild className="self-start md:self-auto" variant="outline">
          <Link href="/api-docs/reference">
            {t("common:apiDocs.referenceCta.action")}
            <ArrowRight />
          </Link>
        </Button>
      </section>
    </section>
  );
}
