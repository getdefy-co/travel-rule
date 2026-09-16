"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, KeyRound, Plus, RefreshCw, RotateCw, ShieldOff } from "lucide-react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createApiClient,
  listApiClients,
  revokeApiClientCredential,
  rotateApiClientCredential,
} from "@/lib/api";

const API_CLIENT_NAME = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const API_CLIENT_SCOPES = ["transfers:read", "transfers:write", "webhooks:manage"];
const LEGACY_CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const OVERLAP_WARNING_TOAST_ID = "api-client-rotation-overlap-warning";
const SECRET_WARNING_TOAST_ID = "api-client-one-time-secret-warning";

const formatDate = (value, fallback) => value
  ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : fallback;

const parseExpiry = (value) => {
  if (!value) return { expiresAt: null, valid: true };
  const timestamp = new Date(value).getTime();
  return { expiresAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null, valid: Number.isFinite(timestamp) && timestamp > Date.now() };
};

const credentialStatus = (credential, clientStatus) => {
  if (credential.revoked_at) return "revoked";
  if (credential.expires_at && new Date(credential.expires_at).getTime() <= Date.now()) return "expired";
  if (clientStatus === "disabled") return "disabled";
  return "active";
};

const isCredentialRevocable = (credential) => (
  !credential.revoked_at
  && (!credential.expires_at || new Date(credential.expires_at).getTime() > Date.now())
);

export function ApiClientManagement() {
  const { t } = useTranslation();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState([]);
  const [createExpiry, setCreateExpiry] = useState("");
  const [createError, setCreateError] = useState([]);
  const [creating, setCreating] = useState(false);
  const [rotateTarget, setRotateTarget] = useState(null);
  const [rotateExpiry, setRotateExpiry] = useState("");
  const [rotateError, setRotateError] = useState("");
  const [rotating, setRotating] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revoking, setRevoking] = useState(false);
  const [secret, setSecret] = useState(null);
  const mountedRef = useRef(false);
  const createPendingRef = useRef(false);
  const rotatePendingRef = useRef(false);
  const revokePendingRef = useRef(false);
  const secretRequestRef = useRef(0);
  const nameInputRef = useRef(null);
  const firstScopeRef = useRef(null);
  const createExpiryRef = useRef(null);
  const rotateExpiryRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    Promise.resolve().then(() => {
      if (!current) return;
      setLoading(true);
      setFailed(false);
      listApiClients().then((result) => {
        if (current) {
          setClients(result.filter((client) => client.id !== LEGACY_CLIENT_ID));
          setLoading(false);
        }
      }).catch(() => {
        if (current) {
          setFailed(true);
          setLoading(false);
          toast.error(t("errors:api.fetchApiClients"));
        }
      });
    });
    return () => {
      current = false;
    };
  }, [revision, t]);

  useEffect(() => {
    if (!rotateTarget) {
      toast.dismiss(OVERLAP_WARNING_TOAST_ID);
      return undefined;
    }

    toast.warning(t("common:configuration.apiClients.overlapHelp"), {
      duration: Infinity,
      id: OVERLAP_WARNING_TOAST_ID,
    });
    return () => toast.dismiss(OVERLAP_WARNING_TOAST_ID);
  }, [rotateTarget, t]);

  useEffect(() => {
    if (!secret) {
      toast.dismiss(SECRET_WARNING_TOAST_ID);
      return undefined;
    }

    toast.warning(t(`common:configuration.apiClients.${secret.kind === "rotated" ? "rotatedSecretHelp" : "createdSecretHelp"}`), {
      duration: Infinity,
      id: SECRET_WARNING_TOAST_ID,
    });
    return () => toast.dismiss(SECRET_WARNING_TOAST_ID);
  }, [secret, t]);

  const refresh = () => setRevision((value) => value + 1);
  const resetCreate = () => {
    setName("");
    setScopes([]);
    setCreateExpiry("");
    setCreateError([]);
  };
  const changeCreateOpen = (open) => {
    if (!open && createPendingRef.current) {
      return;
    }
    setCreateOpen(open);
    if (!open) resetCreate();
  };
  const toggleScope = (scope) => {
    setScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]);
    setCreateError([]);
  };
  const submitCreate = async (event) => {
    event.preventDefault();
    if (createPendingRef.current) {
      return;
    }
    const expiry = parseExpiry(createExpiry);
    const errors = [];
    if (!API_CLIENT_NAME.test(name)) errors.push({ field: "name", label: t("common:configuration.apiClients.name"), message: t("common:configuration.apiClients.nameError"), ref: nameInputRef });
    if (scopes.length === 0 || new Set(scopes).size !== scopes.length) errors.push({ field: "scopes", label: t("common:configuration.apiClients.scopes"), message: t("common:configuration.apiClients.scopeError"), ref: firstScopeRef });
    if (!expiry.valid) errors.push({ field: "expiry", label: t("common:configuration.apiClients.expiry"), message: t("common:configuration.apiClients.expiryError"), ref: createExpiryRef });
    if (errors.length > 0) {
      setCreateError(errors.map(({ field }) => field));
      toast.error(errors.length > 1
        ? t("common:toasts.validation", {
            count: errors.length,
            field: errors[0].label,
            message: errors[0].message,
          })
        : errors[0].message);
      errors[0].ref.current?.focus();
      return;
    }

    setCreateError([]);
    createPendingRef.current = true;
    setCreating(true);
    try {
      const result = await createApiClient({ expiresAt: expiry.expiresAt, name, scopes });
      if (mountedRef.current) {
        createPendingRef.current = false;
        changeCreateOpen(false);
        setSecret({ kind: "created", value: result.api_key });
        refresh();
      }
    } catch (error) {
      if (mountedRef.current) {
        toast.error(error.message);
      }
    } finally {
      createPendingRef.current = false;
      if (mountedRef.current) {
        setCreating(false);
      }
    }
  };
  const submitRotation = async (event) => {
    event.preventDefault();
    if (rotatePendingRef.current) {
      return;
    }
    const expiry = parseExpiry(rotateExpiry);
    if (!expiry.valid) {
      const message = t("common:configuration.apiClients.expiryError");
      setRotateError(message);
      toast.error(message);
      rotateExpiryRef.current?.focus();
      return;
    }

    rotatePendingRef.current = true;
    setRotating(true);
    try {
      const result = await rotateApiClientCredential(rotateTarget.id, { expiresAt: expiry.expiresAt });
      if (mountedRef.current) {
        rotatePendingRef.current = false;
        setRotateTarget(null);
        setRotateExpiry("");
        setRotateError("");
        setSecret({ kind: "rotated", value: result.api_key });
        refresh();
      }
    } catch (error) {
      if (mountedRef.current) {
        toast.error(error.message);
      }
    } finally {
      rotatePendingRef.current = false;
      if (mountedRef.current) {
        setRotating(false);
      }
    }
  };
  const revoke = async () => {
    if (revokePendingRef.current) {
      return;
    }
    revokePendingRef.current = true;
    setRevoking(true);
    try {
      await revokeApiClientCredential(revokeTarget.clientId, revokeTarget.credentialId);
      if (mountedRef.current) {
        revokePendingRef.current = false;
        setRevokeTarget(null);
        toast.success(t("common:configuration.apiClients.revoked"));
        refresh();
      }
    } catch (error) {
      if (mountedRef.current) {
        toast.error(error.message);
      }
    } finally {
      revokePendingRef.current = false;
      if (mountedRef.current) {
        setRevoking(false);
      }
    }
  };
  const copySecret = async () => {
    const requestId = secretRequestRef.current + 1;
    secretRequestRef.current = requestId;
    try {
      await navigator.clipboard.writeText(secret.value);
      if (mountedRef.current && secretRequestRef.current === requestId) {
        toast.success(t("common:toasts.copied"));
      }
    } catch {
      if (mountedRef.current && secretRequestRef.current === requestId) {
        toast.error(t("common:toasts.copyFailed"));
      }
    }
  };
  const closeSecret = () => {
    secretRequestRef.current += 1;
    setSecret(null);
  };
  const fallback = t("common:state.na");

  return (
    <>
      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2"><KeyRound /><h2>{t("common:configuration.apiClients.title")}</h2></CardTitle>
              <CardDescription>{t("common:configuration.apiClients.description")}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button aria-label={t("common:configuration.apiClients.refresh")} disabled={loading} onClick={refresh} size="icon" type="button" variant="outline"><RefreshCw className={loading ? "animate-spin" : ""} /></Button>
              <Button onClick={() => setCreateOpen(true)} type="button"><Plus />{t("common:configuration.apiClients.create")}</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <div aria-label={t("common:configuration.apiClients.loading")} className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div> : null}
          {failed ? <Button onClick={refresh} size="sm" type="button" variant="outline">{t("common:configuration.apiClients.retry")}</Button> : null}
          {!loading && !failed && clients.length === 0 ? <Empty><EmptyHeader><EmptyTitle>{t("common:configuration.apiClients.empty")}</EmptyTitle><EmptyDescription>{t("common:configuration.apiClients.emptyDescription")}</EmptyDescription></EmptyHeader></Empty> : null}
          {!loading && !failed && clients.length > 0 ? <div className="space-y-4">{clients.map((client) => (
            <section aria-label={t("common:configuration.apiClients.clientLabel", { name: client.name })} className="rounded-lg border p-4" key={client.id} role="group">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{client.name}</h3><Badge variant={statusBadgeVariant(client.status)}>{t(`common:configuration.apiClients.statuses.${client.status}`)}</Badge></div>
                  <p className="break-all font-mono text-xs text-muted-foreground">{client.id}</p>
                  <div className="flex flex-wrap gap-1.5">{client.scopes.map((scope) => <Badge key={scope} variant="neutral">{scope}</Badge>)}</div>
                  <p className="text-xs text-muted-foreground">{t("common:configuration.apiClients.createdAt", { value: formatDate(client.created_at, fallback) })}</p>
                </div>
                <Button disabled={client.status !== "active"} onClick={() => { setRotateTarget(client); setRotateError(""); }} size="sm" type="button" variant="outline"><RotateCw />{t("common:configuration.apiClients.rotate")}</Button>
              </div>
              <div className="mt-4 space-y-2 border-t pt-4">
                <h4 className="text-sm font-medium">{t("common:configuration.apiClients.credentials")}</h4>
                {client.credentials.length === 0 ? <p className="text-sm text-muted-foreground">{t("common:configuration.apiClients.noCredentials")}</p> : client.credentials.map((credential) => {
                  const state = credentialStatus(credential, client.status);
                  return (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/30 p-3" key={credential.id}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><span className="break-all font-mono text-xs">{credential.id}</span><Badge variant={statusBadgeVariant(state)}>{t(`common:configuration.apiClients.credentialStatuses.${state}`)}</Badge></div>
                        <p className="mt-1 text-xs text-muted-foreground">{t("common:configuration.apiClients.credentialDates", { created: formatDate(credential.created_at, fallback), expires: formatDate(credential.expires_at, t("common:configuration.apiClients.never")) })}</p>
                      </div>
                      {isCredentialRevocable(credential) ? <Button aria-label={t("common:configuration.apiClients.revoke")} onClick={() => setRevokeTarget({ clientId: client.id, credentialId: credential.id })} size="sm" type="button" variant="outline"><ShieldOff />{t("common:configuration.apiClients.revoke")}</Button> : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}</div> : null}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={changeCreateOpen}>
        <DialogContent>
          <form className="space-y-5" onSubmit={submitCreate}>
            <DialogHeader><DialogTitle>{t("common:configuration.apiClients.createTitle")}</DialogTitle><DialogDescription>{t("common:configuration.apiClients.createDescription")}</DialogDescription></DialogHeader>
            <FieldGroup>
              <Field data-invalid={createError.includes("name")}><FieldLabel htmlFor="api-client-name">{t("common:configuration.apiClients.name")}</FieldLabel><Input aria-invalid={createError.includes("name")} autoComplete="off" id="api-client-name" onChange={(event) => { setName(event.target.value); setCreateError([]); }} ref={nameInputRef} value={name} /><FieldDescription>{t("common:configuration.apiClients.nameHelp")}</FieldDescription></Field>
              <FieldSet aria-invalid={createError.includes("scopes")}><FieldLegend>{t("common:configuration.apiClients.scopes")}</FieldLegend><div className="grid gap-3 sm:grid-cols-2">{API_CLIENT_SCOPES.map((scope, index) => <label className="flex items-center gap-2 rounded-md border p-3 text-sm" key={scope}><input aria-label={scope} aria-invalid={createError.includes("scopes")} checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} ref={index === 0 ? firstScopeRef : undefined} type="checkbox" />{scope}</label>)}</div></FieldSet>
              <Field data-invalid={createError.includes("expiry")}><FieldLabel htmlFor="api-client-expiry">{t("common:configuration.apiClients.expiry")}</FieldLabel><Input aria-invalid={createError.includes("expiry")} id="api-client-expiry" onChange={(event) => { setCreateExpiry(event.target.value); setCreateError([]); }} ref={createExpiryRef} type="datetime-local" value={createExpiry} /><FieldDescription>{t("common:configuration.apiClients.expiryHelp")}</FieldDescription></Field>
            </FieldGroup>
            <DialogFooter><Button onClick={() => changeCreateOpen(false)} type="button" variant="outline">{t("common:configuration.cancel")}</Button><Button disabled={creating} type="submit">{t("common:configuration.apiClients.createAction")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(rotateTarget)} onOpenChange={(open) => { if (!open && !rotatePendingRef.current) { setRotateTarget(null); setRotateExpiry(""); setRotateError(""); } }}>
        <DialogContent>
          <form className="space-y-5" onSubmit={submitRotation}>
            <DialogHeader><DialogTitle>{t("common:configuration.apiClients.rotateTitle")}</DialogTitle><DialogDescription>{t("common:configuration.apiClients.rotateDescription")}</DialogDescription></DialogHeader>
            <Field data-invalid={Boolean(rotateError)}><FieldLabel htmlFor="api-client-rotation-expiry">{t("common:configuration.apiClients.expiry")}</FieldLabel><Input aria-invalid={Boolean(rotateError)} id="api-client-rotation-expiry" onChange={(event) => { setRotateExpiry(event.target.value); setRotateError(""); }} ref={rotateExpiryRef} type="datetime-local" value={rotateExpiry} /><FieldDescription>{t("common:configuration.apiClients.expiryHelp")}</FieldDescription></Field>
            <DialogFooter><Button disabled={rotating} onClick={() => setRotateTarget(null)} type="button" variant="outline">{t("common:configuration.cancel")}</Button><Button disabled={rotating} type="submit">{t("common:configuration.apiClients.rotateAction")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(secret)} onOpenChange={(open) => { if (!open) closeSecret(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("common:configuration.apiClients.secretTitle")}</DialogTitle><DialogDescription>{t("common:configuration.apiClients.secretDescription")}</DialogDescription></DialogHeader>
          <Field><FieldLabel htmlFor="one-time-api-credential">{t("common:configuration.apiClients.secretLabel")}</FieldLabel><div className="flex gap-2"><Input className="font-mono" id="one-time-api-credential" readOnly value={secret?.value || ""} /><Button aria-label={t("common:configuration.apiClients.copySecret")} onClick={copySecret} size="icon" type="button" variant="outline"><Copy /></Button></div></Field>
          <DialogFooter><Button onClick={closeSecret} type="button">{t("common:configuration.apiClients.saved")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(revokeTarget)} onOpenChange={(open) => { if (!open && !revokePendingRef.current) setRevokeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("common:configuration.apiClients.revokeTitle")}</AlertDialogTitle><AlertDialogDescription>{t("common:configuration.apiClients.revokeDescription")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={revoking}>{t("common:configuration.cancel")}</AlertDialogCancel><AlertDialogAction disabled={revoking} onClick={revoke} variant="destructive">{t("common:configuration.apiClients.revokeAction")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
