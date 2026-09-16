"use client";

import { useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getRuntimeConfiguration } from "@/lib/api";

const formatNumber = (value) => new Intl.NumberFormat("en").format(value);
const AUTH_ONLY_TOAST_ID = "runtime-auth-only-notice";

function RuntimeValue({ label, value }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/20 p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

export function RuntimeConfigurationOverview() {
  const { t } = useTranslation();
  const [runtime, setRuntime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let current = true;
    Promise.resolve().then(() => {
      if (!current) return;
      setLoading(true);
      setFailed(false);
      getRuntimeConfiguration().then((result) => {
        if (current) {
          setRuntime(result);
          setLoading(false);
        }
      }).catch(() => {
        if (current) {
          setFailed(true);
          setLoading(false);
          toast.error(t("errors:api.fetchRuntimeConfiguration"));
        }
      });
    });
    return () => {
      current = false;
    };
  }, [revision, t]);

  useEffect(() => {
    if (runtime?.mode !== "auth") {
      toast.dismiss(AUTH_ONLY_TOAST_ID);
      return undefined;
    }

    toast.info(t("common:configuration.runtime.authOnly"), { id: AUTH_ONLY_TOAST_ID });
    return () => toast.dismiss(AUTH_ONLY_TOAST_ID);
  }, [runtime?.mode, t]);

  const retry = () => setRevision((value) => value + 1);

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Activity />
          <h2>{t("common:configuration.runtime.title")}</h2>
          {runtime ? <Badge variant={runtime.mode === "trp" ? "info" : "neutral"}>{runtime.mode.toUpperCase()}</Badge> : null}
        </CardTitle>
        <CardDescription>{t("common:configuration.runtime.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? <div aria-label={t("common:configuration.runtime.loading")} className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : null}
        {failed ? <Button onClick={retry} size="sm" type="button" variant="outline"><RefreshCw />{t("common:configuration.runtime.retry")}</Button> : null}
        {!loading && !failed && runtime ? (
          <div className="space-y-5">
            {runtime.mode === "auth" ? null : (
              <>
                <section aria-label={t("common:configuration.runtime.identityTitle")}>
                  <h3 className="mb-2 text-sm font-semibold">{t("common:configuration.runtime.identityTitle")}</h3>
                  <dl className="grid gap-3 sm:grid-cols-3">
                    <RuntimeValue label={t("common:configuration.runtime.name")} value={runtime.identity.name} />
                    <RuntimeValue label={t("common:configuration.runtime.lei")} value={runtime.identity.lei} />
                    <RuntimeValue label={t("common:configuration.runtime.publicBaseUrl")} value={runtime.identity.public_base_url} />
                  </dl>
                </section>
                <section aria-label={t("common:configuration.runtime.operationsTitle")}>
                  <h3 className="mb-2 text-sm font-semibold">{t("common:configuration.runtime.operationsTitle")}</h3>
                  <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <RuntimeValue label={t("common:configuration.runtime.retention")} value={t("common:configuration.runtime.days", { value: formatNumber(runtime.operations.retention_days) })} />
                    <RuntimeValue label={t("common:configuration.runtime.tokenTtl")} value={t("common:configuration.runtime.seconds", { value: formatNumber(runtime.operations.token_ttl_seconds) })} />
                    <RuntimeValue label={t("common:configuration.runtime.httpTimeout")} value={t("common:configuration.runtime.milliseconds", { value: formatNumber(runtime.operations.http_timeout_ms) })} />
                    <RuntimeValue label={t("common:configuration.runtime.emailFallback")} value={t("common:configuration.runtime.minutes", { value: formatNumber(runtime.operations.email_fallback_delay_minutes) })} />
                  </dl>
                </section>
                <section aria-label={t("common:configuration.runtime.encryptionTitle")}>
                  <h3 className="mb-2 text-sm font-semibold">{t("common:configuration.runtime.encryptionTitle")}</h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <RuntimeValue label={t("common:configuration.runtime.activeKeyId")} value={runtime.encryption.active_key_id} />
                    <RuntimeValue label={t("common:configuration.runtime.retiredKeys")} value={t("common:configuration.runtime.retiredKeyCount", { count: runtime.encryption.retired_key_count })} />
                  </dl>
                </section>
              </>
            )}
            <section aria-label={t("common:configuration.runtime.integrationsTitle")}>
              <h3 className="mb-2 text-sm font-semibold">{t("common:configuration.runtime.integrationsTitle")}</h3>
              <dl className="grid gap-3 sm:grid-cols-2">
                <RuntimeValue label={t("common:configuration.runtime.emailMode")} value={<Badge variant={runtime.integrations.email_mode === "disabled" ? "neutral" : "success"}>{t(`common:configuration.runtime.emailModes.${runtime.integrations.email_mode}`)}</Badge>} />
                <RuntimeValue label={t("common:configuration.runtime.oidc")} value={<Badge variant={runtime.integrations.oidc_enabled ? "success" : "neutral"}>{t(`common:configuration.runtime.${runtime.integrations.oidc_enabled ? "enabled" : "disabled"}`)}</Badge>} />
              </dl>
            </section>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
