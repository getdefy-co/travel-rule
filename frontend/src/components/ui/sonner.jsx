"use client"

import { useEffect } from "react"
import { useTheme } from "next-themes"
import { useTranslation } from "react-i18next"
import { Toaster as Sonner, toast } from "sonner";

const Toaster = ({
  ...props
}) => {
  const { theme = "system" } = useTheme()
  const { t } = useTranslation()

  // Radix modal focus traps prevent Alt+T navigation; this shortcut keeps focus in the form.
  useEffect(() => {
    const dismissLatest = (event) => {
      if (!event.altKey || event.key !== "Escape") return;
      const latest = toast.getToasts().at(-1);
      if (!latest) return;
      event.preventDefault();
      event.stopPropagation();
      toast.dismiss(latest.id);
    };
    document.addEventListener("keydown", dismissLatest, true);
    return () => document.removeEventListener("keydown", dismissLatest, true);
  }, []);

  return (
    // A toast interaction must not reach Radix's outside-pointer listener and close the active dialog.
    <div onPointerDown={(event) => {
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
    }}>
      <Sonner
        theme={theme}
        closeButton
        position="bottom-right"
        containerAriaLabel={t("common:toasts.label")}
        toastOptions={{ closeButtonAriaLabel: t("common:toasts.close") }}
        className="toaster group pointer-events-auto"
        style={
          {
            "--normal-bg": "var(--popover)",
            "--normal-text": "var(--popover-foreground)",
            "--normal-border": "var(--border)"
          }
        }
        {...props} />
    </div>
  );
}

export { Toaster }
