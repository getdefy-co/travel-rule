"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ComplianceCaseDetailDialog } from "@/components/compliance-case-detail-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listComplianceCases } from "@/lib/api";

const CASE_STATES = ["pending", "needs_information", "escalated", "approved", "rejected", "expired"];

export function ComplianceCaseDashboard() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("all");
  const [cases, setCases] = useState({ data: [], limit: 20, page: 1, total: 0 });
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++request.current;
    setLoading(true);
    setError(false);

    try {
      const response = await listComplianceCases({ state: filter === "all" ? null : filter });
      if (request.current === requestId) setCases(response);
    } catch (loadError) {
      if (request.current === requestId) {
        setError(true);
        toast.error(loadError.message);
      }
    } finally {
      if (request.current === requestId) setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    let current = true;
    Promise.resolve().then(() => { if (current) load(); });
    return () => { current = false; request.current += 1; };
  }, [load]);

  return (
    <section aria-label={t("common:compliance.contentLabel")} className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("common:compliance.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("common:compliance.description")}</p>
        </div>
        <Button disabled={loading} onClick={load} type="button" variant="outline">
          <RefreshCw className={loading ? "animate-spin" : ""} />
          {t("common:compliance.refresh")}
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t("common:compliance.queueTitle")}</CardTitle>
          <Select onValueChange={(value) => { request.current += 1; setFilter(value); }} value={filter}>
            <SelectTrigger aria-label={t("common:compliance.stateFilter")} className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common:compliance.allStates")}</SelectItem>
              {CASE_STATES.map((state) => (
                <SelectItem key={state} value={state}>
                  {t(`enums:caseState.${state}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <Table aria-label={t("common:compliance.tableLabel")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common:compliance.externalId")}</TableHead>
                <TableHead>{t("common:compliance.caseState")}</TableHead>
                <TableHead>{t("common:compliance.transferState")}</TableHead>
                <TableHead>{t("common:compliance.approval")}</TableHead>
                <TableHead>{t("common:compliance.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!error && cases.data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.external_id}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(item.state)}>{t(`enums:caseState.${item.state}`)}</Badge>
                  </TableCell>
                  <TableCell>{t(`enums:orchestrationTransferState.${item.transfer_state}`)}</TableCell>
                  <TableCell>{t(`enums:requiredApproval.${item.required_approval}`)}</TableCell>
                  <TableCell>
                    <Button onClick={() => setSelectedCaseId(item.id)} size="sm" type="button" variant="outline">
                      {t("common:compliance.review")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !error && cases.data.length === 0 ? (
                <TableRow>
                  <TableCell className="py-8 text-center text-muted-foreground" colSpan={5}>
                    {t("common:compliance.empty")}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ComplianceCaseDetailDialog
        caseId={selectedCaseId}
        onDecisionComplete={load}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSelectedCaseId(null);
        }}
        open={Boolean(selectedCaseId)}
      />
    </section>
  );
}
