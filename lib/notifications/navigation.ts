type NotificationLike = {
  jobId?: string | null;
  subject?: string | null;
  body?: string | null;
};

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

export function resolveAdminNotificationHref(notification: NotificationLike) {
  if (notification.jobId) {
    return `/admin/jobs/${notification.jobId}`;
  }

  const text = `${notification.subject ?? ""} ${notification.body ?? ""}`.toLowerCase();

  if (includesAny(text, ["pay adjustment", "extra payment", "pay request"])) {
    return "/admin/pay-adjustments";
  }
  if (includesAny(text, ["approval"])) {
    return "/admin/approvals";
  }
  if (includesAny(text, ["laundry"])) {
    return "/admin/laundry";
  }
  if (includesAny(text, ["inventory", "stock", "shopping"])) {
    return "/admin/inventory";
  }
  if (includesAny(text, ["quote", "lead"])) {
    return "/admin/quotes";
  }
  if (includesAny(text, ["report"])) {
    return "/admin/reports";
  }
  if (includesAny(text, ["client", "property"])) {
    return "/admin/clients";
  }
  if (includesAny(text, ["user", "account", "otp"])) {
    return "/admin/users";
  }

  return "/admin/notifications";
}

