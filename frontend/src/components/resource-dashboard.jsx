"use client";

import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { Eye, Plus, RefreshCw, RotateCw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TransferCreateDialog } from "@/components/transfer-create-dialog";
import { TransferEmailDialog } from "@/components/transfer-email-dialog";
import { useAuth } from "@/contexts/AuthContext";
import {
  confirmTrpTransfer,
  createTrpTravelAddress,
  getTrpManagementResource,
  listTrpManagementResources,
  retryTrpTransfer,
} from "@/lib/api";

const PAGE_SIZES = [10, 20, 50];
const TRANSFER_STATES = ["pending", "approved", "rejected", "confirmed", "canceled", "expired"];
const EMAIL_FALLBACK_STATES = new Set(["pending", "approved", "rejected"]);
const DIRECTIONS = ["inbound", "outbound"];
const MESSAGE_PHASES = ["inquiry", "resolution", "confirmation"];
const FILTER_DEFINITIONS = {
  direction: { values: DIRECTIONS, namespace: "direction", all: "allDirections" },
  state: { values: TRANSFER_STATES, namespace: "inquiryStatus", all: "allStates" },
  phase: { values: MESSAGE_PHASES, namespace: "messagePhase", all: "allPhases" },
  delivery_state: { values: ["received", "delivered", "pending", "failed"], namespace: "deliveryState", all: "allDeliveryStates" },
  purpose: { values: MESSAGE_PHASES, namespace: "messagePhase", all: "allPurposes" },
  status: { values: ["active", "consumed", "expired"], namespace: "tokenStatus", all: "allTokenStatuses" },
  event_type: {
    values: ["created", "inquiry_approved", "inquiry_received", "inquiry_rejected", "manual_approval", "manual_rejection", "outbound_transfer_created", "transfer_canceled", "transfer_confirmed", "transfer_expired", "travel_address_created"],
    namespace: "eventType", all: "allEventTypes",
  },
  from_state: { values: TRANSFER_STATES, namespace: "inquiryStatus", all: "allPreviousStates" },
  to_state: { values: TRANSFER_STATES, namespace: "inquiryStatus", all: "allNextStates" },
};
const RESOURCE_FILTERS = {
  transfers: ["direction", "state"],
  messages: ["direction", "phase", "delivery_state"],
  tokens: ["purpose", "status"],
  events: ["event_type", "from_state", "to_state"],
};
const RESOURCE_COLUMNS = {
  events: ["id", "event_type", "from_state", "to_state", "actor_role", "created_at"],
  messages: ["request_identifier", "phase", "direction", "delivery_state", "status_code", "created_at"],
  tokens: ["id", "purpose", "expires_at", "consumed_at", "created_at"],
  transfers: ["id", "direction", "state", "asset_dti", "amount", "expires_at", "updated_at"],
};
const RESOURCE_DETAIL_FIELDS = {
  events: ["id", "transfer_id", "event_type", "from_state", "to_state", "actor_user_id", "actor_role", "created_at"],
  messages: ["id", "transfer_id", "phase", "direction", "logical_identifier", "request_identifier", "delivery_state", "status_code", "error_code", "superseded_by", "created_at", "delivered_at"],
  tokens: ["id", "transfer_id", "purpose", "expires_at", "consumed_at", "created_at"],
  transfers: ["id", "protocol", "direction", "state", "asset_dti", "amount", "expires_at", "retention_until", "created_at", "updated_at"],
};

const formatValue = (key, value, fallback, t) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (key.endsWith("_at") || key === "retention_until") {
    return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }
  if (["state", "from_state", "to_state"].includes(key)) {
    return t(`enums:inquiryStatus.${value}`);
  }
  if (key === "direction") {
    return t(`enums:direction.${value}`);
  }
  if (["phase", "purpose"].includes(key)) {
    return t(`enums:messagePhase.${value}`);
  }
  if (key === "delivery_state") {
    return t(`enums:deliveryState.${value}`);
  }
  if (key === "event_type") {
    return t(`enums:eventType.${value}`);
  }
  if (key === "actor_role") {
    return t(`enums:roles.${value}`);
  }
  return String(value);
};

const getEmailUnavailableMessage = ({ currentTime, item, t }) => {
  if (!item.email_enabled) {
    return t("common:mail.invitation.unavailable");
  }
  if (item.direction !== "outbound") {
    return t("common:mail.invitation.outboundOnly");
  }
  if (item.state === "expired" || (currentTime !== null && item.expires_at && new Date(item.expires_at).getTime() <= currentTime)) {
    return t("common:mail.invitation.expired");
  }
  if (!EMAIL_FALLBACK_STATES.has(item.state)) {
    return t("common:mail.invitation.terminalState");
  }
  if (currentTime !== null && item.email_fallback_available_at && new Date(item.email_fallback_available_at).getTime() > currentTime) {
    return t("common:mail.invitation.availableAt", { value: formatValue("created_at", item.email_fallback_available_at, "", t) });
  }
  return t("common:mail.invitation.unavailable");
};

function StatusBadge({ kind, value }) {
  const { t } = useTranslation();
  const labelKey = kind === "delivery_state" ? `enums:deliveryState.${value}` : `enums:inquiryStatus.${value}`;
  return <Badge variant={statusBadgeVariant(value)}>{t(labelKey)}</Badge>;
}

function MetadataList({ fields, item }) {
  const { t } = useTranslation();
  const fallback = t("common:state.na");

  return (
    <dl className="grid gap-3">
      {fields.map((key) => (
        <div className="grid gap-1 border-b pb-3 sm:grid-cols-[9rem_1fr]" key={key}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`common:resources.columns.${key}`)}</dt>
          <dd className="break-all text-sm">{formatValue(key, item[key], fallback, t)}</dd>
        </div>
      ))}
    </dl>
  );
}

function TransferTimeline({ events }) {
  const { t } = useTranslation();
  const fallback = t("common:state.na");

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("common:resources.detail.noTimeline")}</p>;
  }

  return (
    <ol aria-label={t("common:resources.detail.timelineLabel")} className="grid gap-4">
      {events.map((event) => (
        <li className="grid gap-1 border-l-2 border-primary pl-4" key={event.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{formatValue("event_type", event.event_type, fallback, t)}</span>
            <span className="text-xs text-muted-foreground">{formatValue("created_at", event.created_at, fallback, t)}</span>
          </div>
          <span className="break-all font-mono text-xs text-muted-foreground">{event.id}</span>
          <span className="text-sm text-muted-foreground">
            {formatValue("from_state", event.from_state, fallback, t)} → {formatValue("to_state", event.to_state, fallback, t)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function TravelAddressCreateDialog({ onComplete, onOpenChange, open }) {
  const { t } = useTranslation();
  const [beneficiary, setBeneficiary] = useState("");
  const [invalid, setInvalid] = useState(false);
  const input = useRef(null);
  const active = useRef(false);
  const submitLock = useRef(false);
  useEffect(() => {
    active.current = open;
    return () => { active.current = false; };
  }, [open]);
  const [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    if (!beneficiary.trim()) {
      setInvalid(true);
      input.current.focus();
      toast.error(t("common:resources.forms.ivms.validation.required"));
      return;
    }
    submitLock.current = true;
    setInvalid(false);
    setSaving(true);
    try {
      await createTrpTravelAddress({ beneficiary_reference: beneficiary.trim() });
      if (!active.current) return;
      setBeneficiary("");
      onOpenChange(false);
      onComplete();
    } catch {
      if (active.current) toast.error(t("errors:api.createTrpTravelAddress"));
    } finally {
      submitLock.current = false;
      if (active.current) setSaving(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <form noValidate onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("common:resources.forms.addressTitle")}</DialogTitle>
            <DialogDescription>{t("common:resources.forms.addressDescription")}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-6">
            <Field>
              <FieldLabel htmlFor="beneficiary">{t("common:resources.forms.beneficiary")}</FieldLabel>
              <Input aria-invalid={invalid} ref={input} id="beneficiary" onChange={(event) => { setBeneficiary(event.target.value); setInvalid(false); }} placeholder={t("common:resources.forms.beneficiaryPlaceholder")} required value={beneficiary} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button disabled={saving} onClick={() => onOpenChange(false)} type="button" variant="outline">{t("common:resources.actions.cancel")}</Button>
            <Button aria-busy={saving} disabled={saving} type="submit">{t("common:resources.forms.createAddress")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResourceDetail({ admin, id, onChanged, onOpenChange, resource }) {
  const { t } = useTranslation();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState(null);
  const [txid, setTxid] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(null);
  const active = useRef(false);
  const actionLock = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    getTrpManagementResource(resource, id).then((result) => {
      if (current) {
        setItem(result);
        setLoading(false);
      }
    }).catch(() => {
      if (current) {
        toast.error(t("errors:api.fetchTrpManagementResource"));
        setFailed(true);
        setLoading(false);
      }
    });
    return () => {
      current = false;
    };
  }, [id, resource, revision, t]);

  useEffect(() => {
    const timer = setTimeout(() => setCurrentTime(Date.now()), 0);
    return () => clearTimeout(timer);
  }, [id, revision]);

  const retryDetail = () => {
    setLoading(true);
    setFailed(false);
    setItem(null);
    setRevision((current) => current + 1);
  };
  const chooseAction = (nextAction) => {
    setTxid("");
    setAction(nextAction);
  };
  const run = async () => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      if (action === "retry") {
        await retryTrpTransfer(resource === "messages" ? item.transfer_id : item.id);
      } else {
        await confirmTrpTransfer(item.id, action === "confirm" ? { txid: txid.trim() } : { canceled: null });
      }
      if (!active.current) return;
      setAction(null);
      onOpenChange(false);
      onChanged();
    } catch {
      if (active.current) toast.error(t(action === "retry" ? "errors:api.retryTrpTransfer" : "errors:api.confirmTrpTransfer"));
    } finally {
      actionLock.current = false;
      if (active.current) setBusy(false);
    }
  };
  const closeAction = (open) => {
    if (!open && !busy) {
      setAction(null);
    }
  };
  const hasTransferActions = admin && resource === "transfers" && item?.actions;
  const hasMessageActions = admin && resource === "messages" && item?.actions;
  const emailUnavailableReason = hasTransferActions && !item.actions.can_email ? getEmailUnavailableMessage({ currentTime, item, t }) : "";
  const emailInfoReady = currentTime !== null;
  useEffect(() => {
    if (emailUnavailableReason && emailInfoReady) {
      toast.info(emailUnavailableReason, { id: "transfer-email-unavailable" });
    }
    return () => { toast.dismiss("transfer-email-unavailable"); };
  }, [emailInfoReady, emailUnavailableReason]);

  return (
    <>
      <Sheet onOpenChange={onOpenChange} open>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{t(`common:resources.detail.${resource}Title`)}</SheetTitle>
            <SheetDescription>{t("common:resources.detail.description")}</SheetDescription>
          </SheetHeader>
          {loading ? (
            <div aria-label={t("common:resources.detail.loading")} className="grid gap-3 px-4" role="status">
              {[0, 1, 2, 3].map((row) => <Skeleton className="h-12 w-full" key={row} />)}
            </div>
          ) : null}
          {failed ? (
            <Button className="mx-4 w-fit" onClick={retryDetail} size="sm" type="button" variant="outline">{t("common:resources.actions.retryDetails")}</Button>
          ) : null}
          {item && resource === "transfers" ? (
            <Tabs className="px-4" defaultValue="details">
              <TabsList>
                <TabsTrigger value="details">{t("common:resources.detail.details")}</TabsTrigger>
                <TabsTrigger value="timeline">{t("common:resources.detail.timeline")}</TabsTrigger>
              </TabsList>
              <TabsContent className="pt-4" value="details"><MetadataList fields={RESOURCE_DETAIL_FIELDS.transfers} item={item} /></TabsContent>
              <TabsContent className="pt-4" value="timeline"><TransferTimeline events={item.events} /></TabsContent>
            </Tabs>
          ) : null}
          {item && resource !== "transfers" ? (
            <div className="px-4"><MetadataList fields={RESOURCE_DETAIL_FIELDS[resource]} item={item} /></div>
          ) : null}
          {hasTransferActions ? (
            <div className="mt-auto flex flex-wrap gap-2 border-t p-4">
              {item.actions.can_confirm ? <Button onClick={() => chooseAction("confirm")} type="button">{t("common:resources.actions.confirmTransfer")}</Button> : null}
              {item.actions.can_cancel ? <Button onClick={() => chooseAction("cancel")} type="button" variant="destructive">{t("common:resources.actions.cancelTransfer")}</Button> : null}
              {item.actions.can_retry ? <Button onClick={() => chooseAction("retry")} type="button" variant="outline"><RotateCw />{t("common:resources.actions.retryDelivery")}</Button> : null}
              <Button
                disabled={!item.actions.can_email}
                onClick={() => setEmailOpen(true)}
                type="button"
                variant="outline"
              >
                {t("common:mail.invitation.action")}
              </Button>
            </div>
          ) : null}
          {hasMessageActions && item.actions.can_retry ? (
            <div className="mt-auto border-t p-4">
              <Button onClick={() => chooseAction("retry")} type="button" variant="outline"><RotateCw />{t("common:resources.actions.retryDelivery")}</Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
      {action ? (
        <AlertDialog onOpenChange={closeAction} open>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`common:resources.confirm.${action}Title`)}</AlertDialogTitle>
              <AlertDialogDescription>{t(`common:resources.confirm.${action}Description`)}</AlertDialogDescription>
            </AlertDialogHeader>
            {action === "confirm" ? (
              <Field>
                <FieldLabel htmlFor="txid">{t("common:resources.forms.txid")}</FieldLabel>
                <Input id="txid" onChange={(event) => setTxid(event.target.value)} placeholder={t("common:resources.forms.txidPlaceholder")} required value={txid} />
              </Field>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>{t("common:resources.actions.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                aria-busy={busy}
                disabled={busy || (action === "confirm" && !txid.trim())}
                onClick={(event) => {
                  event.preventDefault();
                  run();
                }}
              >
                {t(`common:resources.confirm.${action}Action`)}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      {item && resource === "transfers" && emailOpen ? (
        <TransferEmailDialog
          onComplete={() => {
            retryDetail();
            onChanged();
          }}
          onOpenChange={setEmailOpen}
          open={emailOpen}
          transferId={item.id}
        />
      ) : null}
    </>
  );
}

export function ResourceDashboard({ resource }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = user?.role === "admin" || user?.role === "platform_admin";
  const [result, setResult] = useState({ data: [], limit: 20, page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [filters, setFilters] = useState({});
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const listRequest = useRef(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [createMode, setCreateMode] = useState(null);
  const columns = RESOURCE_COLUMNS[resource];

  useEffect(() => {
    let current = true;
    const requestId = ++listRequest.current;
    const options = { limit, page, search: deferredSearch };
    RESOURCE_FILTERS[resource].forEach((key) => { options[key] = filters[key] || "all"; });
    listTrpManagementResources(resource, options).then((response) => {
      if (current && listRequest.current === requestId) {
        setResult(response);
        setLoading(false);
      }
    }).catch(() => {
      if (current && listRequest.current === requestId) {
        toast.error(t("errors:api.fetchTrpManagementResources"));
        setFailed(true);
        setLoading(false);
      }
    });
    return () => {
      current = false;
    };
  }, [deferredSearch, filters, limit, page, resource, revision, t]);

  const refresh = useCallback(() => {
    setLoading(true);
    setFailed(false);
    setRevision((current) => current + 1);
  }, []);
  const updateFilter = (key, value) => {
    listRequest.current += 1;
    setLoading(true);
    setFailed(false);
    setPage(1);
    if (key === "search") setSearch(value);
    else setFilters((current) => ({ ...current, [key]: value }));
  };
  const changePage = (nextPage) => {
    setLoading(true);
    setFailed(false);
    setPage(nextPage);
  };
  const totalPages = Math.max(1, Math.ceil(result.total / limit));
  const fallback = t("common:state.na");

  return (
    <section aria-label={t(`common:resources.${resource}.contentLabel`)} className="flex flex-1 flex-col gap-6 p-4 md:p-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t(`common:resources.${resource}.title`)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t(`common:resources.${resource}.description`)}</p>
        </div>
        {resource === "transfers" && admin ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setCreateMode("address")} type="button" variant="outline"><Plus />{t("common:resources.actions.createAddress")}</Button>
            <Button onClick={() => setCreateMode("transfer")} type="button"><Plus />{t("common:resources.actions.newTransfer")}</Button>
          </div>
        ) : null}
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center gap-2 border-b p-4">
          <InputGroup className="max-w-sm">
            <InputGroupAddon><Search /></InputGroupAddon>
            <InputGroupInput
              aria-label={t(`common:resources.filters.searchLabels.${resource}`)}
              maxLength={100}
              onChange={(event) => updateFilter("search", event.target.value)}
              placeholder={t(`common:resources.filters.searchPlaceholders.${resource}`)}
              value={search}
            />
          </InputGroup>
          {RESOURCE_FILTERS[resource].map((key) => {
            const { values, namespace, all } = FILTER_DEFINITIONS[key];
            return (
              <Select key={key} onValueChange={(value) => updateFilter(key, value)} value={filters[key] || "all"}>
                <SelectTrigger aria-label={t(`common:resources.filters.${key}`)}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t(`common:resources.filters.${all}`)}</SelectItem>
                  {values.map((value) => <SelectItem key={value} value={value}>{t(`enums:${namespace}.${value}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            );
          })}
          <Select
            onValueChange={(value) => {
              setLoading(true);
              setFailed(false);
              setLimit(Number(value));
              setPage(1);
            }}
            value={String(limit)}
          >
            <SelectTrigger aria-label={t("common:resources.filters.rows")}><SelectValue /></SelectTrigger>
            <SelectContent>{PAGE_SIZES.map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent>
          </Select>
          <Button aria-label={t("common:resources.actions.refresh")} className="ml-auto" disabled={loading} onClick={refresh} size="icon" type="button" variant="outline">
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
        <CardContent className="px-0">
          {failed ? (
            <Button className="mt-3 block" onClick={refresh} size="sm" type="button" variant="outline">{t("common:resources.actions.retry")}</Button>
          ) : null}
          {!failed && !loading && result.data.length === 0 ? (
            <Empty className="min-h-72">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Search /></EmptyMedia>
                <EmptyTitle>{t(`common:resources.${resource}.empty`)}</EmptyTitle>
                <EmptyDescription>{t("common:resources.emptyDescription")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {!failed && (loading || result.data.length > 0) ? (
            <div className="overflow-x-auto">
              <Table aria-label={t(`common:resources.${resource}.tableLabel`)}>
                <TableHeader>
                  <TableRow>
                    {columns.map((key) => <TableHead key={key}>{t(`common:resources.columns.${key}`)}</TableHead>)}
                    <TableHead className="text-right">{t("common:resources.columns.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? [0, 1, 2].map((row) => (
                    <TableRow key={row}>
                      {[...columns, "actions"].map((cell) => <TableCell key={cell}><Skeleton className="h-6 w-24" /></TableCell>)}
                    </TableRow>
                  )) : result.data.map((item) => (
                    <TableRow key={item.id}>
                      {columns.map((key) => (
                        <TableCell className={key.includes("identifier") || key === "id" ? "max-w-56 break-all font-mono text-xs" : "whitespace-nowrap"} key={key}>
                          {["state", "delivery_state"].includes(key) ? <StatusBadge kind={key} value={item[key]} /> : formatValue(key, item[key], fallback, t)}
                        </TableCell>
                      ))}
                      <TableCell className="text-right">
                        <Button aria-label={t(`common:resources.actions.view.${resource}`, { id: item.id })} onClick={() => setSelectedId(item.id)} size="icon" type="button" variant="ghost"><Eye /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
          <div className="flex flex-col items-center justify-between gap-3 border-t p-4 sm:flex-row">
            <p className="text-sm text-muted-foreground">{t("common:resources.total", { total: result.total })}</p>
            <div className="flex items-center gap-3">
              <Button disabled={page <= 1 || loading} onClick={() => changePage(page - 1)} size="sm" type="button" variant="outline">{t("common:resources.previous")}</Button>
              <span className="text-sm">{t("common:resources.page", { page, totalPages })}</span>
              <Button disabled={page >= totalPages || loading} onClick={() => changePage(page + 1)} size="sm" type="button" variant="outline">{t("common:resources.next")}</Button>
            </div>
          </div>
        </CardContent>
      </Card>
      {selectedId ? (
        <ResourceDetail
          admin={admin}
          id={selectedId}
          onChanged={refresh}
          onOpenChange={(open) => {
            if (!open) setSelectedId(null);
          }}
          resource={resource}
        />
      ) : null}
      {resource === "transfers" && createMode === "address" ? <TravelAddressCreateDialog onComplete={refresh} onOpenChange={(open) => !open && setCreateMode(null)} open /> : null}
      {resource === "transfers" && createMode === "transfer" ? <TransferCreateDialog onComplete={refresh} onOpenChange={(open) => !open && setCreateMode(null)} open /> : null}
    </section>
  );
}
