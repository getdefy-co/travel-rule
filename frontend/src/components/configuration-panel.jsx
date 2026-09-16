"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Eye, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ApiClientManagement } from "@/components/api-client-management";
import { RuntimeConfigurationOverview } from "@/components/runtime-configuration-overview";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { getServiceApiKey, revealServiceApiKey, rotateServiceApiKey } from "@/lib/api";

const isValidKey = (value) => value.length >= 32 && value.length <= 256 && /^[\x21-\x7e]+$/.test(value);
const LEGACY_WARNING_TOAST_ID = "configuration-legacy-key-warning";
const ROTATION_WARNING_TOAST_ID = "configuration-rotation-warning";

export function ConfigurationPanel() {
  const { t } = useTranslation();
  const [metadata, setMetadata] = useState(null);
  const [revealed, setRevealed] = useState("");
  const [nextKey, setNextKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [validation, setValidation] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const keyInputRef = useRef(null);
  const loadRequestRef = useRef(0);
  const mountedRef = useRef(false);
  const revealPendingRef = useRef(false);
  const rotationPendingRef = useRef(false);
  const rotationStarted = Boolean(nextKey);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (failed) {
      toast.dismiss(LEGACY_WARNING_TOAST_ID);
      return undefined;
    }

    toast.warning(t("common:configuration.legacyWarningTitle"), {
      description: t("common:configuration.legacyWarningDescription"),
      duration: Infinity,
      id: LEGACY_WARNING_TOAST_ID,
    });
    return () => toast.dismiss(LEGACY_WARNING_TOAST_ID);
  }, [failed, t]);

  useEffect(() => {
    if (!rotationStarted) {
      toast.dismiss(ROTATION_WARNING_TOAST_ID);
      return undefined;
    }

    toast.warning(t("common:configuration.warningTitle"), {
      description: t("common:configuration.warningDescription"),
      duration: Infinity,
      id: ROTATION_WARNING_TOAST_ID,
    });
    return () => toast.dismiss(ROTATION_WARNING_TOAST_ID);
  }, [rotationStarted, t]);

  const load = useCallback(() => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setLoading(true);
    setFailed(false);
    getServiceApiKey().then((result) => {
      if (mountedRef.current && loadRequestRef.current === requestId) {
        setMetadata(result);
        setRevealed("");
        setLoading(false);
      }
    }).catch(() => {
      if (mountedRef.current && loadRequestRef.current === requestId) {
        setFailed(true);
        setLoading(false);
        toast.error(t("errors:api.fetchServiceApiKey"));
      }
    });
  }, [t]);
  useEffect(() => {
    let current = true;
    Promise.resolve().then(() => {
      if (current) {
        load();
      }
    });
    return () => {
      current = false;
    };
  }, [load]);

  const reveal = async () => {
    if (revealPendingRef.current) {
      return;
    }
    revealPendingRef.current = true;
    try {
      const result = await revealServiceApiKey();
      if (mountedRef.current) {
        setRevealed(result.api_key);
      }
    } catch (error) {
      if (mountedRef.current) {
        toast.error(error.message);
      }
    } finally {
      revealPendingRef.current = false;
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(revealed);
      if (mountedRef.current) {
        toast.success(t("common:toasts.copied"));
      }
    } catch {
      if (mountedRef.current) {
        toast.error(t("common:toasts.copyFailed"));
      }
    }
  };
  const requestRotation = (event) => {
    event.preventDefault();
    const valid = isValidKey(nextKey);
    setValidation(!valid);
    if (!valid) {
      toast.error(t("common:configuration.keyRequirements"));
      keyInputRef.current?.focus();
      return;
    }
    setConfirming(true);
  };
  const rotate = async () => {
    if (rotationPendingRef.current) {
      return;
    }
    rotationPendingRef.current = true;
    setSaving(true);
    try {
      const result = await rotateServiceApiKey(nextKey);
      if (mountedRef.current) {
        setMetadata(result);
        setNextKey("");
        setRevealed("");
        setConfirming(false);
        toast.success(t("common:configuration.rotated"));
      }
    } catch (error) {
      if (mountedRef.current) {
        toast.error(error.message);
      }
    } finally {
      rotationPendingRef.current = false;
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  };
  const changeConfirming = (open) => {
    if (!open && rotationPendingRef.current) {
      return;
    }
    setConfirming(open);
  };

  return (
    <section aria-label={t("common:configuration.contentLabel")} className="flex flex-1 flex-col gap-6 p-4 md:p-8">
      <div className="flex flex-wrap items-start gap-3"><div><h1 className="text-3xl font-bold tracking-tight">{t("common:configuration.title")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("common:configuration.description")}</p></div><Badge className="mt-1" variant="accent">{t("common:configuration.adminOnly")}</Badge></div>
      <RuntimeConfigurationOverview />
      <ApiClientManagement />
      {failed ? <div><Button onClick={load} size="sm" type="button" variant="outline">{t("common:configuration.retry")}</Button></div> : null}
      {!failed ? <Card><CardHeader><CardTitle className="flex items-center gap-2"><KeyRound />{t("common:configuration.serviceKey")}</CardTitle><CardDescription>{t("common:configuration.serviceKeyDescription")}</CardDescription></CardHeader><CardContent className="space-y-8">
        {loading ? <Skeleton className="h-9 w-full" /> : <Field><FieldLabel htmlFor="current-service-key">{t("common:configuration.currentKey")}</FieldLabel><InputGroup><InputGroupInput id="current-service-key" readOnly type={revealed ? "text" : "password"} value={revealed || metadata?.masked || t("common:configuration.notConfigured")} /><InputGroupButton aria-label={t("common:configuration.reveal")} disabled={!metadata?.configured || Boolean(revealed)} onClick={reveal} size="sm"><Eye />{t("common:configuration.reveal")}</InputGroupButton><InputGroupButton aria-label={t("common:configuration.copy")} disabled={!revealed} onClick={copy} size="sm"><Copy />{t("common:configuration.copy")}</InputGroupButton></InputGroup><FieldDescription>{t("common:configuration.revealHelp")}</FieldDescription></Field>}
        <form className="space-y-5 border-t pt-6" onSubmit={requestRotation}><div><h2 className="text-lg font-semibold">{t("common:configuration.rotateTitle")}</h2><p className="text-sm text-muted-foreground">{t("common:configuration.rotateDescription")}</p></div><FieldGroup><Field data-invalid={validation}><FieldLabel htmlFor="new-service-key">{t("common:configuration.newKey")}</FieldLabel><Input aria-invalid={validation} autoComplete="new-password" id="new-service-key" onChange={(event) => { setNextKey(event.target.value); setValidation(false); }} placeholder={t("common:configuration.newKeyPlaceholder")} ref={keyInputRef} type="password" value={nextKey} /><FieldDescription>{t("common:configuration.keyRequirements")}</FieldDescription></Field></FieldGroup><div className="flex justify-end gap-2"><Button onClick={() => { setNextKey(""); setValidation(false); }} type="button" variant="outline">{t("common:configuration.cancel")}</Button><Button type="submit">{t("common:configuration.rotateAction")}</Button></div></form>
      </CardContent></Card> : null}
      <AlertDialog onOpenChange={changeConfirming} open={confirming}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("common:configuration.confirmTitle")}</AlertDialogTitle><AlertDialogDescription>{t("common:configuration.confirmDescription")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={saving}>{t("common:configuration.cancel")}</AlertDialogCancel><AlertDialogAction disabled={saving} onClick={rotate}>{t("common:configuration.confirmAction")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </section>
  );
}
