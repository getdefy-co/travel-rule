"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listTravelRuleEmailJobs, retryTravelRuleEmailJob } from "@/lib/api";

const EMAIL_STATES = ["queued", "processing", "failed", "sent", "dead_lettered", "consumed", "expired"];

const formatDate = (value, fallback) => (value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : fallback);

export function EmailDeliveryDashboard() {
  const { t } = useTranslation();
  const [result, setResult] = useState({ data: [], limit: 20, page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retryingId, setRetryingId] = useState(null);
  const active = useRef(false);
  const retryLock = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    listTravelRuleEmailJobs({ limit: 20, page, status })
      .then((response) => {
        if (current) {
          setResult(response);
          setLoading(false);
        }
      })
      .catch(() => {
        if (current) {
          toast.error(t("errors:api.fetchTravelRuleEmails"));
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      current = false;
    };
  }, [page, revision, status, t]);

  const refresh = useCallback(() => {
    setLoading(true);
    setFailed(false);
    setRevision((current) => current + 1);
  }, []);
  const retry = async (id) => {
    if (retryLock.current) return;
    retryLock.current = true;
    setRetryingId(id);
    try {
      await retryTravelRuleEmailJob(id);
      if (active.current) refresh();
    } catch {
      if (active.current) toast.error(t("errors:api.retryTravelRuleEmail"));
    } finally {
      retryLock.current = false;
      if (active.current) setRetryingId(null);
    }
  };
  const totalPages = Math.max(1, Math.ceil(result.total / 20));
  const fallback = t("common:state.na");

  return (
    <section aria-label={t("common:mail.contentLabel")} className="flex flex-1 flex-col gap-6 p-4 md:p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("common:mail.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("common:mail.description")}</p>
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex items-center gap-2 border-b p-4">
          <Select
            onValueChange={(value) => {
              setLoading(true);
              setFailed(false);
              setPage(1);
              setStatus(value);
            }}
            value={status}
          >
            <SelectTrigger aria-label={t("common:mail.statusFilter")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common:mail.allStatuses")}</SelectItem>
              {EMAIL_STATES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`enums:emailStatus.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button aria-label={t("common:mail.refresh")} className="ml-auto" disabled={loading} onClick={refresh} size="icon" type="button" variant="outline">
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
        <CardContent className="px-0">
          {failed ? <Button className="m-4" onClick={refresh} size="sm" type="button" variant="outline">{t("common:mail.retryList")}</Button> : null}
          {!failed && !loading && result.data.length === 0 ? (
            <Empty className="min-h-72">
              <EmptyHeader>
                <EmptyTitle>{t("common:mail.empty")}</EmptyTitle>
                <EmptyDescription>{t("common:mail.emptyDescription")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {!failed && (loading || result.data.length > 0) ? (
            <Table aria-label={t("common:mail.tableLabel")}>
              <TableHeader>
                <TableRow>
                  {["recipient", "status", "attempts", "errorCode", "created", "sent", "expires", "consumed", "actions"].map((key) => (
                    <TableHead key={key}>{t(`common:mail.columns.${key}`)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? [0, 1, 2].map((row) => (
                      <TableRow key={row}>
                        {Array.from({ length: 10 }, (_, cell) => (
                          <TableCell key={cell}>
                            <Skeleton className="h-6 w-24" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : result.data.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.recipient_email}</TableCell>
                        <TableCell>
                          <Badge variant={statusBadgeVariant(item.status)}>{t(`enums:emailStatus.${item.status}`)}</Badge>
                        </TableCell>
                        <TableCell>{item.attempts}</TableCell>
                        <TableCell>{item.last_error_code || fallback}</TableCell>
                        <TableCell>{formatDate(item.created_at, fallback)}</TableCell>
                        <TableCell>{formatDate(item.sent_at, fallback)}</TableCell>
                        <TableCell>{formatDate(item.expires_at, fallback)}</TableCell>
                        <TableCell>{formatDate(item.consumed_at, fallback)}</TableCell>
                        <TableCell>
                          {item.status === "dead_lettered" ? (
                            <Button
                              aria-busy={retryingId === item.id}
                              disabled={Boolean(retryingId) && item.status === "dead_lettered"}
                              onClick={() => retry(item.id)}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              {t("common:mail.retry")}
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          ) : null}
          <div className="flex items-center justify-between gap-3 border-t p-4">
            <span className="text-sm text-muted-foreground">{t("common:mail.total", { total: result.total })}</span>
            <div className="flex items-center gap-2">
              <Button
                aria-label={t("common:mail.previous")}
                disabled={page <= 1 || loading}
                onClick={() => {
                  setLoading(true);
                  setFailed(false);
                  setPage((current) => current - 1);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {t("common:resources.previous")}
              </Button>
              <span className="text-sm">{t("common:resources.page", { page, totalPages })}</span>
              <Button
                aria-label={t("common:mail.next")}
                disabled={page >= totalPages || loading}
                onClick={() => {
                  setLoading(true);
                  setFailed(false);
                  setPage((current) => current + 1);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {t("common:resources.next")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
