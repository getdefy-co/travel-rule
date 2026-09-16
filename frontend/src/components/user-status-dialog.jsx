"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, UserCheck, UserX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function UserStatusDialogContent({ action, onConfirm, onOpenChange, onSuccess, pendingRef, user }) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const mountedRef = useRef(false);
  const deactivating = action === "deactivate";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const confirm = async () => {
    /* istanbul ignore next -- the disabled button is primary; this ref closes the same-tick race. */
    if (submitLock.current) {
      return;
    }

    submitLock.current = true;
    pendingRef.current = true;
    setSubmitting(true);
    try {
      await onConfirm(user.email);
      if (mountedRef.current) {
        pendingRef.current = false;
        onSuccess();
        onOpenChange(false);
      }
    } catch (error) {
      if (mountedRef.current) {
        toast.error(error.message || t("errors:api.userMutationFailed"));
      }
    } finally {
      submitLock.current = false;
      pendingRef.current = false;
      if (mountedRef.current) {
        setSubmitting(false);
      }
    }
  };

  const titleKey = deactivating ? "modals:userStatus.deactivateTitle" : "modals:userStatus.activateTitle";
  const pendingKey = deactivating ? "modals:userStatus.deactivating" : "modals:userStatus.activating";
  const confirmKey = deactivating ? "modals:userStatus.deactivate" : "modals:userStatus.activate";

  return (
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b px-5 py-5">
          <div className="flex items-center gap-3">
            <div className={deactivating
              ? "flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
              : "flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"}
            >
              {deactivating ? <UserX className="size-4" /> : <UserCheck className="size-4" />}
            </div>
            <div>
              <DialogTitle>{t(titleKey)}</DialogTitle>
              <DialogDescription className="mt-1">
                {t(deactivating ? "modals:userStatus.deactivateDescription" : "modals:userStatus.activateDescription")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 px-5 py-5">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="break-all text-sm font-medium">{user.email}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(deactivating ? "modals:userStatus.activeNow" : "modals:userStatus.inactiveNow")}
            </p>
          </div>
        </div>

        <DialogFooter className="border-t bg-muted/20 px-5 py-4">
          <Button disabled={submitting} onClick={() => onOpenChange(false)} type="button" variant="outline">
            {t("modals:userStatus.cancel")}
          </Button>
          <Button
            aria-label={t(submitting ? pendingKey : confirmKey)}
            disabled={submitting}
            onClick={confirm}
            type="button"
            variant={deactivating ? "destructive" : "default"}
          >
            {submitting ? <Loader2 className="animate-spin" /> : null}
            {t(submitting ? pendingKey : confirmKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
  );
}

export function UserStatusDialog({ action, onConfirm, onOpenChange, onSuccess, open, user }) {
  const pendingRef = useRef(false);
  const changeOpen = (nextOpen) => {
    if (!nextOpen && pendingRef.current) {
      return;
    }

    onOpenChange(nextOpen);
  };

  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      {open && user ? (
        <UserStatusDialogContent
          action={action}
          key={`${action}-${user.email}`}
          onConfirm={onConfirm}
          onOpenChange={changeOpen}
          onSuccess={onSuccess}
          pendingRef={pendingRef}
          user={user}
        />
      ) : null}
    </Dialog>
  );
}
