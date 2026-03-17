import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(amount)
}

export function formatDate(date: Date | string, fmt = "dd/MM/yyyy"): string {
  const { format } = require("date-fns")
  return format(new Date(date), fmt)
}
