"use client";

import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, Loader2 } from "lucide-react";
import {
  EAlert,
  EButton,
  EPageHeader,
  EstateSkin,
} from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";
import "@/app/v2/estate.css";
import "./operations.css";

export function OperationsPage({
  title,
  description,
  children,
  accent = "admin",
  backHref = "/v2/admin",
  backLabel = "Back to workspace",
  embedded = false,
  panel = false,
  pending = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  accent?: ComponentProps<typeof EstateSkin>["accent"];
  backHref?: string;
  backLabel?: string;
  embedded?: boolean;
  panel?: boolean;
  pending?: boolean;
}) {
  const content = (
    <fieldset disabled={pending} className="min-w-0 space-y-6">
      {children}
    </fieldset>
  );
  if (panel)
    return (
      <OperationsPanel
        embedded
        label={typeof title === "string" ? title : undefined}
      >
        {content}
      </OperationsPanel>
    );
  const Content = embedded ? "div" : "main";
  return (
    <EstateSkin accent={accent} className={embedded ? undefined : "ops-page"}>
      <Content
        className={cn(
          "ops-content mx-auto w-full max-w-5xl space-y-6",
          !embedded && "px-4 py-6 sm:px-6 sm:py-8",
        )}
      >
        <EButton asChild variant="ghost" className="min-h-11 print:hidden">
          <a href={backHref}>
            <ArrowLeft size={16} aria-hidden />
            {backLabel}
          </a>
        </EButton>
        <EPageHeader
          eyebrow="Property services"
          title={title}
          description={description}
        />
        {content}
      </Content>
    </EstateSkin>
  );
}

/**
 * A secondary tool inside an existing workspace. Loads only when opened and
 * keeps its draft mounted while collapsed. Presented as an Estate card row:
 * icon, title, one-line purpose and a chevron.
 */
export function OperationsDisclosure({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  /** A rendered icon element; an element crosses the server/client boundary. */
  icon?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  return (
    <section className="ops-disclosure">
      <h2 className="m-0">
        <button
          type="button"
          className="ops-disclosure-toggle"
          aria-label={title}
          aria-describedby={description ? descriptionId : undefined}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            setVisited(true);
            setOpen((value) => !value);
          }}
        >
          {icon ? (
            <span className="ops-disclosure-icon" aria-hidden>
              {icon}
            </span>
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="ops-disclosure-title">{title}</span>
            {description ? (
              <span id={descriptionId} className="ops-disclosure-description">
                {description}
              </span>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden
            size={18}
            className={cn(
              "ops-disclosure-chevron",
              open && "rotate-180",
            )}
          />
        </button>
      </h2>
      <div id={id} hidden={!open} className="ops-disclosure-body">
        {visited ? children : null}
      </div>
    </section>
  );
}

/** Embedded panels inherit their portal's accent; never introduce another main landmark. */
export function OperationsPanel({
  children,
  className,
  accent = "admin",
  label,
  embedded = false,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  embedded?: boolean;
  accent?: ComponentProps<typeof EstateSkin>["accent"];
}) {
  return (
    <section
      aria-label={label}
      data-skin={embedded ? undefined : "estate"}
      data-portal-accent={embedded ? undefined : accent}
      className={cn(
        "ops-content space-y-4",
        !embedded && "ops-card",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function OperationsButton({
  className,
  ...props
}: ComponentProps<typeof EButton>) {
  return (
    <EButton
      className={cn(
        "min-h-11 max-w-full whitespace-normal text-left",
        className,
      )}
      {...props}
    />
  );
}

export function OperationsNotice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "success" | "warning" | "danger";
}) {
  return (
    <div
      className="print:hidden"
      role={tone === "danger" ? "alert" : "status"}
      aria-live={tone === "danger" ? "assertive" : "polite"}
    >
      <EAlert tone={tone}>{children}</EAlert>
    </div>
  );
}

export function OperationsLoading({
  label = "Loading workspace…",
}: {
  label?: string;
}) {
  return (
    <p role="status" className="flex items-center gap-2 py-4">
      <Loader2
        aria-hidden
        size={18}
        className="animate-spin motion-reduce:animate-none"
      />
      {label}
    </p>
  );
}
