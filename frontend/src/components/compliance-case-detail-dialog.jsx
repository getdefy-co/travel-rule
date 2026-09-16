"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { decideComplianceCase, getComplianceCase } from "@/lib/api";

const APPROVER_ROLES = new Set(["admin", "compliance_approver", "platform_admin"]);
const REVIEWER_ROLES = new Set(["compliance_reviewer", "user"]);
const TERMINAL_STATES = new Set(["approved", "expired", "rejected"]);

function MetadataItem({ label, value }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/30 p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

function DetailLoading() {
  return (
    <div aria-label="Loading compliance case details" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((item) => (
          <Skeleton className="h-20" key={item} />
        ))}
      </div>
    </div>
  );
}

const decisionName = (decision) => {
  if (decision === "approved") {
    return "approval";
  }
  if (decision === "rejected") {
    return "rejection";
  }
  return "escalation";
};

export function ComplianceCaseDetailDialog({ caseId, onDecisionComplete, onOpenChange, open }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("detail");
  const [reason, setReason] = useState("");
  const [validationError, setValidationError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const detailRequest = useRef(0);
  const submitLock = useRef(false);
  const decisionInput = useRef(null);

  const loadDetail = useCallback(
    async (reset = false) => {
      const requestId = detailRequest.current + 1;
      detailRequest.current = requestId;
      if (reset) {
        setDetail(null);
        setStage("detail");
        setReason("");
        setValidationError("");
        submitLock.current = false;
        setSubmitting(false);
      }
      setLoading(true);
      setError(false);

      try {
        const response = await getComplianceCase(caseId);
        if (detailRequest.current === requestId) {
          setDetail(response);
          setLoading(false);
        }
      } catch {
        if (detailRequest.current === requestId) {
          setError(true);
          toast.error(t("errors:api.fetchComplianceCase"));
          setLoading(false);
        }
      }
    },
    [caseId, t],
  );

  useEffect(() => {
    if (!open || !caseId) {
      detailRequest.current += 1;
      return;
    }

    let current = true;
    Promise.resolve().then(() => { if (current) loadDetail(true); });
    return () => {
      current = false;
      detailRequest.current += 1;
    };
  }, [caseId, loadDetail, open]);

  const isReviewer = REVIEWER_ROLES.has(user?.role);
  const isApprover = APPROVER_ROLES.has(user?.role);
  const isTerminal = TERMINAL_STATES.has(detail?.state);
  const requiresApprover = detail?.required_approval === "compliance_approver";
  const awaitingReviewer = !isTerminal && requiresApprover && detail?.state !== "escalated" && isApprover;
  const reviewerApproval = !isTerminal && requiresApprover && detail?.state !== "escalated" && isReviewer;
  const canApprove = !isTerminal && (requiresApprover ? (detail?.state === "escalated" ? isApprover : isReviewer) : isReviewer || isApprover);
  const canReject = !isTerminal && (isReviewer || isApprover);
  const canEscalate = !isTerminal && detail?.state !== "escalated" && isReviewer;

  useEffect(() => {
    if (!open || !awaitingReviewer || detail?.id !== caseId) return;
    const id = `compliance-reviewer-required-${caseId}`;
    toast.warning(t("modals:complianceReview.reviewerRequired"), { id, duration: Infinity });
    return () => { toast.dismiss(id); };
  }, [awaitingReviewer, caseId, detail?.id, open, t]);

  const beginDecision = (decision) => {
    setValidationError("");
    setStage(decision);
  };

  const reviewDecision = (decision) => {
    if (!reason.trim()) {
      const message = t("modals:complianceReview.reasonRequired");
      setValidationError(message);
      decisionInput.current?.focus();
      toast.error(message);
      return;
    }

    setValidationError("");
    setStage(`confirm-${decision}`);
  };

  const submitDecision = async (decision) => {
    /* istanbul ignore next -- disabled state is primary; the ref closes the same-tick race. */
    if (submitLock.current) {
      return;
    }

    const requestId = detailRequest.current;
    submitLock.current = true;
    setSubmitting(true);

    try {
      const response = await decideComplianceCase(caseId, {
        decision,
        expected_version: detail.version,
        reason: reason.trim(),
      });
      if (detailRequest.current !== requestId) return;
      const successKey = decision === "approved" && response.case_state === "escalated" ? "reviewerApprovalSuccess" : `${decision}Success`;
      toast.success(t(`modals:complianceReview.${successKey}`));
      onOpenChange(false);
      onDecisionComplete();
    } catch (requestError) {
      if (detailRequest.current !== requestId) return;
      if (requestError.status === 409) {
        toast.error(t("modals:complianceReview.conflict"));
        setStage("detail");
        setSubmitting(false);
        await loadDetail();
        if (detailRequest.current === requestId + 1) onDecisionComplete();
      } else {
        toast.error(t("errors:api.decideComplianceCase"));
      }
    } finally {
      submitLock.current = false;
      if (detailRequest.current === requestId) setSubmitting(false);
    }
  };

  const closeDialog = (nextOpen) => {
    if (!nextOpen) {
      detailRequest.current += 1;
    }
    onOpenChange(nextOpen);
  };

  const actionName = decisionName(stage.replace("confirm-", ""));
  const confirmationKey = reviewerApproval && stage === "confirm-approved" ? "reviewerApprovalConfirmation" : `${actionName}Confirmation`;

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("modals:complianceReview.title")}</DialogTitle>
          <DialogDescription>{t("modals:complianceReview.description")}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <DetailLoading />
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <Button className="mt-3" onClick={() => loadDetail()} size="sm" type="button" variant="outline">
              {t("modals:complianceReview.retryDetails")}
            </Button>
          </div>
        ) : detail ? (
          <div className="space-y-6">
            <dl className="grid gap-3 sm:grid-cols-2">
              <MetadataItem label={t("common:compliance.externalId")} value={detail.external_id} />
              <MetadataItem label={t("common:compliance.caseState")} value={<Badge variant={statusBadgeVariant(detail.state)}>{t(`enums:caseState.${detail.state}`)}</Badge>} />
              <MetadataItem label={t("common:compliance.transferState")} value={t(`enums:orchestrationTransferState.${detail.transfer_state}`)} />
              <MetadataItem label={t("common:compliance.approval")} value={t(`enums:requiredApproval.${detail.required_approval}`)} />
              <MetadataItem label={t("common:compliance.version")} value={detail.version} />
            </dl>


            {stage === "detail" && (canApprove || canReject || canEscalate) ? (
              <DialogFooter>
                {canReject ? (
                  <Button onClick={() => beginDecision("rejected")} type="button" variant="destructive">
                    {t("modals:complianceReview.reject")}
                  </Button>
                ) : null}
                {canEscalate ? (
                  <Button onClick={() => beginDecision("escalated")} type="button" variant="outline">
                    {t("modals:complianceReview.escalate")}
                  </Button>
                ) : null}
                {canApprove ? (
                  <Button onClick={() => beginDecision("approved")} type="button">
                    {t(reviewerApproval ? "modals:complianceReview.recordReviewerApproval" : "modals:complianceReview.approve")}
                  </Button>
                ) : null}
              </DialogFooter>
            ) : null}

            {["approved", "escalated", "rejected"].includes(stage) ? (
              <form
                className="rounded-lg border p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  reviewDecision(stage);
                }}
              >
                <Label htmlFor="case-decision-reason" className="mb-4">
                  {t("modals:complianceReview.reason")}
                </Label>
                <Input ref={decisionInput} aria-invalid={Boolean(validationError)} id="case-decision-reason" placeholder={t("modals:complianceReview.reasonPlaceholder")} onChange={(event) => { setValidationError(""); setReason(event.target.value); }} value={reason} />
                <DialogFooter className="mt-4">
                  <Button onClick={() => setStage("detail")} type="button" variant="outline">
                    {t("modals:complianceReview.back")}
                  </Button>
                  <Button type="submit" variant={stage === "rejected" ? "destructive" : "default"}>
                    {t(
                      stage === "approved" && reviewerApproval
                        ? "modals:complianceReview.reviewReviewerApproval"
                        : `modals:complianceReview.review${decisionName(stage).replace(/^./, (character) => character.toUpperCase())}`,
                    )}
                  </Button>
                </DialogFooter>
              </form>
            ) : null}

            {stage.startsWith("confirm-") ? (
              <div className={`rounded-lg border p-4 ${stage === "confirm-rejected" ? "border-destructive/30 bg-destructive/5" : "border-primary/30 bg-primary/5"}`}>
                <p className="text-sm">{t(`modals:complianceReview.${confirmationKey}`, { reason: reason.trim() })}</p>
                <DialogFooter className="mt-4">
                  <Button disabled={submitting} onClick={() => setStage(stage.replace("confirm-", ""))} type="button" variant="outline">
                    {t("modals:complianceReview.back")}
                  </Button>
                  <Button disabled={submitting} onClick={() => submitDecision(stage.replace("confirm-", ""))} type="button" variant={stage === "confirm-rejected" ? "destructive" : "default"}>
                    {t(
                      stage === "confirm-approved" && reviewerApproval
                        ? "modals:complianceReview.confirmReviewerApproval"
                        : `modals:complianceReview.confirm${actionName.replace(/^./, (character) => character.toUpperCase())}`,
                    )}
                  </Button>
                </DialogFooter>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
