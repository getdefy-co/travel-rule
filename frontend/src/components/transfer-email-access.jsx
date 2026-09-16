"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { consumeTravelRuleEmailAccess } from "@/lib/api";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function PartyList({ parties, title }) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        {parties.length === 0 ? <p className="text-sm text-muted-foreground">{t("common:shared.none")}</p> : parties.map((party, index) => (
          <section className="grid gap-2 border-b pb-4 last:border-0 last:pb-0" key={`${party.type}-${index}`}>
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{party.name || t("common:state.na")}</h3><Badge variant="neutral">{t(`enums:personType.${party.type}`)}</Badge></div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">{t("common:shared.country")}</dt><dd>{party.country || t("common:state.na")}</dd></div>
              <div><dt className="text-muted-foreground">{t("common:shared.accounts")}</dt><dd className="break-all">{party.accounts.join(", ") || t("common:state.na")}</dd></div>
            </dl>
            {party.addresses.map((address, addressIndex) => (
              <address className="text-sm not-italic text-muted-foreground" key={`${address.country}-${addressIndex}`}>
                {[...address.lines, address.town, address.country].filter(Boolean).join(", ")}
              </address>
            ))}
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

export function TransferEmailAccess() {
  const { t } = useTranslation();
  const [token, setToken] = useState();
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const consuming = useRef(false);

  useEffect(() => {
    let current = true;
    active.current = true;
    Promise.resolve().then(() => {
      if (!current) return;
      const candidate = new URLSearchParams(window.location.hash.slice(1)).get("token");
      if (candidate && TOKEN_PATTERN.test(candidate)) {
        setToken(candidate);
      } else {
        setToken(null);
        toast.error(t("common:shared.unavailable"), { description: t("common:shared.unavailableDescription") });
      }
    });
    return () => {
      current = false;
      active.current = false;
    };
  }, [t]);

  const consume = async () => {
    if (consuming.current) return;
    consuming.current = true;
    setBusy(true);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    try {
      const result = await consumeTravelRuleEmailAccess(token);
      if (!active.current) return;
      setSummary(result);
      setToken(null);
    } catch {
      if (!active.current) return;
      setToken(null);
      toast.error(t("common:shared.unavailable"), { description: t("common:shared.unavailableDescription") });
    } finally {
      consuming.current = false;
      if (active.current) setBusy(false);
    }
  };

  if (token === undefined) {
    return <main aria-busy="true" className="min-h-svh bg-muted/30" />;
  }

  return (
    <main className="min-h-svh bg-muted/30 px-4 py-10 sm:px-6">
      <div className="mx-auto grid max-w-5xl gap-6">
        <header className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">{t("common:shared.eyebrow")}</p>
          <h1 className="text-3xl font-bold tracking-tight">{t("common:shared.title")}</h1>
          <p className="max-w-2xl text-muted-foreground">{t("common:shared.description")}</p>
        </header>
        {!summary && token ? (
          <Card className="max-w-xl">
            <CardHeader><CardTitle>{t("common:shared.readyTitle")}</CardTitle><CardDescription>{t("common:shared.readyDescription")}</CardDescription></CardHeader>
            <CardContent><Button aria-busy={busy} disabled={busy} onClick={consume} type="button">{t("common:shared.view")}</Button></CardContent>
          </Card>
        ) : null}
        {summary ? (
          <>
            <Card>
              <CardHeader><CardTitle>{t("common:shared.transferTitle")}</CardTitle></CardHeader>
              <CardContent><dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-sm text-muted-foreground">{t("common:shared.transferId")}</dt><dd className="break-all font-mono text-xs">{summary.transfer.id}</dd></div>
                <div><dt className="text-sm text-muted-foreground">{t("common:shared.status")}</dt><dd><Badge variant={statusBadgeVariant(summary.transfer.state)}>{t(`enums:inquiryStatus.${summary.transfer.state}`)}</Badge></dd></div>
                <div><dt className="text-sm text-muted-foreground">{t("common:shared.asset")}</dt><dd>{summary.transfer.asset?.dti || t("common:state.na")}</dd></div>
                <div><dt className="text-sm text-muted-foreground">{t("common:shared.amount")}</dt><dd>{summary.transfer.amount || t("common:state.na")}</dd></div>
              </dl></CardContent>
            </Card>
            <div className="grid gap-6 lg:grid-cols-2">
              <PartyList parties={summary.originators} title={t("common:shared.originators")} />
              <PartyList parties={summary.beneficiaries} title={t("common:shared.beneficiaries")} />
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
