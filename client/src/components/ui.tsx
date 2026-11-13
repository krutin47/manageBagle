import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleDashed, CircleDot, Loader2, Minus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Dialog as RDialog } from "radix-ui";
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import type { Area, Priority, Status } from "../lib/api";
import { statusLabel } from "../lib/labels";
import { addDays, todayISO } from "../lib/time";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

// ---- Buttons ---------------------------------------------------------------------------------

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, block, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("btn", `btn-${variant}`, `btn-${size}`, block && "btn-block", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="spin" size={16} aria-hidden /> : icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cx("icon-btn", `icon-btn-${size}`, className)} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
});

// ---- Form fields -----------------------------------------------------------------------------

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  className?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}

export function Field({ label, hint, error, optional, className, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cx("field", className)}>
      <label htmlFor={id} className="field-label">
        {label}
        {optional && <span className="field-optional">optional</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      <AnimatePresence initial={false}>
        {error ? (
          <motion.p key="error" id={`${id}-error`} className="field-error" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            {error}
          </motion.p>
        ) : hint ? (
          <p key="hint" id={`${id}-hint`} className="field-hint">
            {hint}
          </p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx("input", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx("input textarea", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <span className={cx("select", className)}>
      <select ref={ref} className="input" {...rest}>
        {children}
      </select>
      <ChevronDown size={16} aria-hidden />
    </span>
  );
});

export function AreaSelect({ areas, value, onChange, ...rest }: { areas: Area[]; value: string | null; onChange: (id: string | null) => void } & Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  const color = areas.find((a) => a.id === value)?.color ?? "none";
  return (
    <span className="area-select" data-area={color}>
      <span className="area-dot" aria-hidden />
      <Select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} {...rest}>
        <option value="">No focus area</option>
        {areas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
    </span>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
}

/** A radio group drawn as a segmented control, with a sliding thumb. */
export function Segmented<T extends string>({ label, value, options, onChange, size = "md" }: SegmentedProps<T>) {
  const name = useId();
  return (
    <div className={cx("segmented", `segmented-${size}`)} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.value} className={cx("segment", o.value === value && "is-on")}>
          <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
          {o.value === value && <motion.span layoutId={`${name}-thumb`} className="segment-thumb" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
          <span className="segment-label">{o.label}</span>
        </label>
      ))}
    </div>
  );
}

// ---- Dialog ----------------------------------------------------------------------------------

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  width?: "sm" | "md";
}

export function Dialog({ open, onClose, title, description, children, width = "md" }: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <AnimatePresence>
        {open && (
          <RDialog.Portal forceMount>
            <RDialog.Overlay asChild forceMount>
              <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
            </RDialog.Overlay>
            <div className="dialog-positioner">
              <RDialog.Content asChild forceMount aria-describedby={description ? undefined : undefined}>
                <motion.div
                  className={cx("dialog", `dialog-${width}`)}
                  initial={{ opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                >
                  <header className="dialog-head">
                    <div>
                      <RDialog.Title className="dialog-title">{title}</RDialog.Title>
                      {description ? <RDialog.Description className="dialog-desc">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
                    </div>
                    <RDialog.Close asChild>
                      <IconButton label="Close">
                        <X size={18} />
                      </IconButton>
                    </RDialog.Close>
                  </header>
                  {children}
                </motion.div>
              </RDialog.Content>
            </div>
          </RDialog.Portal>
        )}
      </AnimatePresence>
    </RDialog.Root>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; body: string; confirmLabel: string; loading?: boolean }) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={body} width="sm">
      <footer className="dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </footer>
    </Dialog>
  );
}

// ---- Small display pieces --------------------------------------------------------------------

export function AreaChip({ area, compact }: { area: Area | undefined; compact?: boolean }) {
  if (!area) return compact ? null : <span className="chip" data-area="none">No area</span>;
  return (
    <span className="chip" data-area={area.color}>
      <span className="area-dot" aria-hidden />
      {area.name}
    </span>
  );
}

export function StatusIcon({ status, size = 16 }: { status: Status; size?: number }) {
  if (status === "Done") return <Check size={size} strokeWidth={3} aria-hidden />;
  if (status === "InProgress") return <CircleDot size={size} aria-hidden />;
  if (status === "Skipped") return <Minus size={size} strokeWidth={3} aria-hidden />;
  return <CircleDashed size={size} aria-hidden />;
}

/** Status is always icon + word, never colour alone. */
export function StatusPill({ status }: { status: Status }) {
  return (
    <span className="status-pill" data-status={status}>
      <StatusIcon status={status} size={12} />
      {statusLabel[status]}
    </span>
  );
}

export function PriorityMark({ priority }: { priority: Priority }) {
  const bars = priority === "High" ? 3 : priority === "Medium" ? 2 : 1;
  return (
    <span className="priority" data-priority={priority} title={`${priority} priority`}>
      <span className="priority-bars" aria-hidden>
        {[1, 2, 3].map((i) => (
          <i key={i} className={i <= bars ? "on" : undefined} />
        ))}
      </span>
      {priority}
    </span>
  );
}

export function DateNav({ value, onChange, step, label, children }: { value: string; onChange: (iso: string) => void; step: 1 | 7; label: string; children?: ReactNode }) {
  const unit = step === 1 ? "day" : "week";
  return (
    <div className="date-nav" role="group" aria-label={label}>
      <IconButton label={`Previous ${unit}`} onClick={() => onChange(addDays(value, -step))}>
        <ChevronLeft size={18} />
      </IconButton>
      <Button size="sm" onClick={() => onChange(todayISO())}>
        {step === 1 ? "Today" : "This week"}
      </Button>
      <IconButton label={`Next ${unit}`} onClick={() => onChange(addDays(value, step))}>
        <ChevronRight size={18} />
      </IconButton>
      {children}
    </div>
  );
}

export function PageHeader({ eyebrow, title, sub, actions }: { eyebrow?: string; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden>
        {icon}
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function Skeleton({ height = 16, width = "100%", radius }: { height?: number | string; width?: number | string; radius?: number }) {
  return <span className="skeleton" style={{ height, width, borderRadius: radius }} aria-hidden />;
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="error-note" role="alert">
      <span>{children}</span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Logo({ size = 28, wordmark = true }: { size?: number; wordmark?: boolean }) {
  return (
    <span className="logo">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" className="logo-bg" />
        <circle cx="16" cy="16" r="7.5" fill="none" className="logo-ring" strokeWidth="5" />
        <path d="M16 8.5a7.5 7.5 0 0 1 7.5 7.5" fill="none" className="logo-arc" strokeWidth="5" strokeLinecap="round" />
      </svg>
      {wordmark && (
        <span className="logo-word">
          manage<b>Bagle</b>
        </span>
      )}
    </span>
  );
}
