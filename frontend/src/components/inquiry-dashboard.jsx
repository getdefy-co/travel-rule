"use client";

import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { InquiryDetailDialog } from "@/components/inquiry-detail-dialog";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listTrpInquiries } from "@/lib/api";

const INQUIRY_STATUSES = ["pending", "approved", "rejected", "confirmed", "canceled", "expired"];
const PAGE_SIZES = [10, 25, 50];

const formatDate = (value, fallback) => {
  if (!value) {
    return fallback;
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

export function InquiryDashboard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [list, setList] = useState({ data: [], total: 0, page: 1, limit: 10 });
  const [counts, setCounts] = useState({});
  const [countErrors, setCountErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [selectedInquiryId, setSelectedInquiryId] = useState(null);
  const listRequest = useRef(0);
  const countRequest = useRef(0);

  const loadCounts = useCallback(() => {
    const requestId = countRequest.current + 1;
    countRequest.current = requestId;
    setCountErrors([]);
    Promise.all(INQUIRY_STATUSES.map(async (inquiryStatus) => {
      try {
        const response = await listTrpInquiries({ status: inquiryStatus, page: 1, limit: 1 });
        return [inquiryStatus, response.total, false];
      } catch {
        return [inquiryStatus, null, true];
      }
    })).then((results) => {
      if (countRequest.current !== requestId) {
        return;
      }
      setCounts(Object.fromEntries(results.map(([inquiryStatus, total]) => [inquiryStatus, total])));
      const failures = results.filter(([, , failed]) => failed).map(([inquiryStatus]) => inquiryStatus);
      setCountErrors(failures);
      if (failures.length) toast.warning(t("common:dashboard.partialCounts"));
    });
  }, [t]);

  useEffect(() => {
    let current = true;
    Promise.resolve().then(() => { if (current) loadCounts(); });
    return () => { current = false; countRequest.current += 1; };
  }, [loadCounts]);

  const loadList = useCallback(() => {
    const requestId = listRequest.current + 1;
    listRequest.current = requestId;
    setLoading(true);
    setListError(false);

    listTrpInquiries({
      ...(deferredSearch ? { search: deferredSearch } : {}),
      status: status === "all" ? null : status,
      page,
      limit,
    }).then((response) => {
      if (listRequest.current === requestId) {
        setList(response);
        setLoading(false);
      }
    }).catch(() => {
      if (listRequest.current === requestId) {
        toast.error(t("errors:api.inquiryListFailed"));
        setListError(true);
        setLoading(false);
      }
    });
  }, [deferredSearch, limit, page, status, t]);

  useEffect(() => {
    let current = true;
    Promise.resolve().then(() => { if (current) loadList(); });
    return () => { current = false; listRequest.current += 1; };
  }, [loadList]);

  const refresh = useCallback(() => {
    loadCounts();
    loadList();
  }, [loadCounts, loadList]);

  const changeStatus = (nextStatus) => {
    if (nextStatus === status && page === 1) return;
    listRequest.current += 1;
    setLoading(true);
    setListError(false);
    setStatus(nextStatus);
    setPage(1);
  };

  const changeLimit = (nextLimit) => {
    listRequest.current += 1;
    setLoading(true);
    setListError(false);
    setLimit(Number(nextLimit));
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(list.total / limit));
  const fallback = t("common:state.na");

  return (
    <section aria-label={t("common:dashboard.contentLabel")} className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("common:dashboard.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("common:dashboard.description")}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {INQUIRY_STATUSES.map((inquiryStatus) => {
          const count = counts[inquiryStatus];
          const unavailable = countErrors.includes(inquiryStatus);
          const accessibleCount = unavailable ? t("common:dashboard.unavailable") : count ?? t("common:state.loading");
          return (
            <Card className={status === inquiryStatus ? "border-primary ring-1 ring-primary" : ""} key={inquiryStatus}>
              <button
                aria-label={`${t(`enums:inquiryStatus.${inquiryStatus}`)} ${accessibleCount}`}
                aria-pressed={status === inquiryStatus}
                className="cursor-pointer rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() => changeStatus(inquiryStatus)}
                type="button"
              >
                <CardHeader className="px-4 pb-0">
                  <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t(`enums:inquiryStatus.${inquiryStatus}`)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pt-3">
                  {count === undefined && !unavailable ? <Skeleton className="h-8 w-14" /> : (
                    <span className="text-2xl font-semibold">{unavailable ? "—" : count}</span>
                  )}
                </CardContent>
              </button>
            </Card>
          );
        })}
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <div aria-label={t("common:dashboard.filtersLabel")} className="flex flex-wrap items-center gap-2 border-b p-4" role="group">
          <InputGroup className="max-w-sm">
            <InputGroupAddon><Search /></InputGroupAddon>
            <InputGroupInput
              aria-label={t("common:resources.filters.searchLabels.inquiries")}
              maxLength={100}
              onChange={(event) => {
                listRequest.current += 1;
                setLoading(true);
                setListError(false);
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={t("common:resources.filters.searchPlaceholder")}
              value={search}
            />
          </InputGroup>
          <Select onValueChange={changeStatus} value={status}>
            <SelectTrigger aria-label={t("common:dashboard.statusFilter")} className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common:dashboard.allStatuses")}</SelectItem>
              {INQUIRY_STATUSES.map((inquiryStatus) => (
                <SelectItem key={inquiryStatus} value={inquiryStatus}>{t(`enums:inquiryStatus.${inquiryStatus}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select onValueChange={changeLimit} value={String(limit)}>
            <SelectTrigger aria-label={t("common:dashboard.rowsPerPage")} className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((pageSize) => <SelectItem key={pageSize} value={String(pageSize)}>{pageSize}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button aria-label={t("common:dashboard.refresh")} className="ml-auto" disabled={loading} onClick={refresh} size="icon" type="button" variant="outline">
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </div>

        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table aria-label={t("common:dashboard.tableLabel")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common:dashboard.columns.id")}</TableHead>
                  <TableHead>{t("common:dashboard.columns.status")}</TableHead>
                  <TableHead>{t("common:dashboard.columns.assetDti")}</TableHead>
                  <TableHead>{t("common:dashboard.columns.amount")}</TableHead>
                  <TableHead>{t("common:dashboard.columns.created")}</TableHead>
                  <TableHead>{t("common:dashboard.columns.expires")}</TableHead>
                  <TableHead className="text-right">{t("common:dashboard.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? [0, 1, 2].map((row) => (
                  <TableRow key={row}>
                    {[0, 1, 2, 3, 4, 5, 6].map((cell) => <TableCell key={cell}><Skeleton className="h-6 w-full" /></TableCell>)}
                  </TableRow>
                )) : null}
                {!loading && listError ? (
                  <TableRow>
                    <TableCell className="h-40 text-center" colSpan={7}>
                      <Button className="mt-3" onClick={refresh} size="sm" type="button" variant="outline">{t("common:dashboard.retry")}</Button>
                    </TableCell>
                  </TableRow>
                ) : null}
                {!loading && !listError && list.data.length === 0 ? (
                  <TableRow>
                    <TableCell className="h-40 text-center text-muted-foreground" colSpan={7}>{t("common:dashboard.empty")}</TableCell>
                  </TableRow>
                ) : null}
                {!loading && !listError ? list.data.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-64 font-mono text-xs">{item.id}</TableCell>
                    <TableCell><Badge variant={statusBadgeVariant(item.state)}>{t(`enums:inquiryStatus.${item.state}`)}</Badge></TableCell>
                    <TableCell>{item.asset_dti || fallback}</TableCell>
                    <TableCell>{item.amount || fallback}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(item.created_at, fallback)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(item.expires_at, fallback)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        aria-label={t("common:dashboard.reviewInquiry", { id: item.id })}
                        onClick={() => setSelectedInquiryId(item.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Eye />
                        {t("common:dashboard.review")}
                      </Button>
                    </TableCell>
                  </TableRow>
                )) : null}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-4 sm:flex-row">
            <p className="text-sm text-muted-foreground">{t("common:dashboard.total", { total: list.total })}</p>
            <div className="flex items-center gap-3">
              <Button aria-label={t("common:dashboard.previous")} disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)} size="sm" type="button" variant="outline">
                {t("common:dashboard.previousLabel")}
              </Button>
              <span className="text-sm">{t("common:dashboard.page", { page, totalPages })}</span>
              <Button aria-label={t("common:dashboard.next")} disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)} size="sm" type="button" variant="outline">
                {t("common:dashboard.nextLabel")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <InquiryDetailDialog
        inquiryId={selectedInquiryId}
        onDecisionComplete={refresh}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setSelectedInquiryId(null);
          }
        }}
        open={Boolean(selectedInquiryId)}
      />
    </section>
  );
}
