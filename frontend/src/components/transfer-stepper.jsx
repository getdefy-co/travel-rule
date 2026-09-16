"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export function TransferStepper({
  activeStep,
  ariaLabel,
  completedSteps = [],
  disabled = false,
  errorSteps = [],
  onStepChange,
  progressLabel,
  steps,
}) {
  const completed = new Set(completedSteps);
  const errors = new Set(errorSteps);

  return (
    <nav aria-label={ariaLabel} className="w-full">
      <ol className="flex w-full items-start">
        {steps.map((step, index) => {
          const isActive = index === activeStep;
          const isCompleted = completed.has(index);
          const hasError = errors.has(index);
          const isNavigable = isActive || isCompleted;
          const state = hasError
            ? "error"
            : isActive
              ? "active"
              : isCompleted
                ? "completed"
                : "pending";
          const connectorCompleted = isCompleted && !hasError;

          return (
            <li
              className={cn("flex min-w-0 items-start", index < steps.length - 1 && "flex-1")}
              key={step.id}
            >
              <div className="flex shrink-0 flex-col items-center gap-2">
                <button
                  aria-current={isActive ? "step" : undefined}
                  aria-label={step.label}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full border text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 sm:size-8",
                    state === "active" && "border-primary bg-primary text-primary-foreground",
                    state === "completed" && "border-primary bg-primary text-primary-foreground",
                    state === "pending" && "border-border bg-muted text-muted-foreground",
                    state === "error" && "border-destructive bg-destructive text-white",
                  )}
                  data-state={state}
                  data-slot="transfer-step-trigger"
                  disabled={disabled || !isNavigable}
                  onClick={() => onStepChange(index)}
                  type="button"
                >
                  {isCompleted && !isActive && !hasError ? (
                    <Check
                      aria-hidden="true"
                      data-slot="transfer-step-check"
                      data-testid="transfer-step-check"
                    />
                  ) : (
                    <span aria-hidden="true">{index + 1}</span>
                  )}
                </button>
                <span
                  className={cn(
                    "hidden max-w-28 text-center text-xs font-medium sm:block",
                    state === "active" && "text-primary",
                    state === "completed" && "text-foreground",
                    state === "pending" && "text-muted-foreground",
                    state === "error" && "text-destructive",
                  )}
                  data-slot="transfer-step-title"
                  data-testid="transfer-step-title"
                >
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "mx-1 mt-[0.8125rem] h-0.5 min-w-1 flex-1 transition-colors sm:mx-2 sm:mt-[0.9375rem] sm:min-w-3",
                    connectorCompleted ? "bg-primary" : "bg-border",
                  )}
                  data-slot="transfer-step-connector"
                  data-state={connectorCompleted ? "completed" : "pending"}
                  data-testid="transfer-step-connector"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-center text-sm font-medium sm:hidden">{progressLabel}</p>
    </nav>
  );
}
