import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { toast } from "sonner";
import i18n from "@/i18n/config";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export const getNetworkBadgeColor = (network) => {
  switch (network?.toLowerCase()) {
    case "eth":
      return "bg-slate-500/15 text-slate-700 border-slate-200 dark:text-slate-400 dark:border-slate-800";
    case "bsc":
      return "bg-yellow-500/15 text-yellow-700 border-yellow-200 dark:text-yellow-400 dark:border-yellow-800";
    case "polygon":
      return "bg-purple-500/15 text-purple-700 border-purple-200 dark:text-purple-400 dark:border-purple-800";
    case "avalanche":
      return "bg-red-500/15 text-red-700 border-red-200 dark:text-red-400 dark:border-red-800";
    case "bitcoin":
      return "bg-orange-500/15 text-orange-700 border-orange-200 dark:text-orange-400 dark:border-orange-800";
    case "trx":
      return "bg-rose-500/15 text-rose-700 border-rose-200 dark:text-rose-400 dark:border-rose-800";
    case "solana":
      return "bg-teal-500/15 text-teal-700 border-teal-200 dark:text-teal-400 dark:border-teal-800";
    case "xrp":
      return "bg-blue-500/15 text-blue-700 border-blue-200 dark:text-blue-400 dark:border-blue-800";
    case "arbitrum":
      return "bg-blue-700/10 text-blue-500 border-blue-300 dark:text-blue-800 dark:border-blue-800";
    case "optimism":
      return "bg-red-100/20 text-red-700 border-red-100 dark:text-red-400 dark:border-red-500";
    default:
      return "bg-gray-500/15 text-gray-700 border-gray-200 dark:text-gray-400 dark:border-gray-800";
  }
};

export const getActionBadgeColor = (action) => {
  switch (action) {
    case "block":
      return "bg-red-500/15 text-red-700 border-red-200 dark:text-red-400 dark:border-red-800";
    case "suspicious":
      return "bg-yellow-500/15 text-yellow-700 border-yellow-200 dark:text-yellow-400 dark:border-yellow-800";
    default:
      return "bg-green-500/15 text-green-700 border-green-200 dark:text-green-400 dark:border-green-800";
  }
};

export const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(i18n.t("common:toasts.copied"));
  } catch {
    toast.error(i18n.t("common:toasts.copyFailed"));
  }
};
