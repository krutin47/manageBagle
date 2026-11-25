import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu, Popover, Tooltip } from "radix-ui";
import { useState, type ReactNode } from "react";
import { cx } from "./ui";

interface Option<T extends string> {
  value: T;
  label: string;
  /** Focus-area colour key, shown as a dot. */
  area?: string;
}

interface OptionChipProps<T extends string> {
  /** What the option is, for screen readers: "Length", "Focus area". */
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  icon?: ReactNode;
  /** Draws the chip as a coloured tag bubble (focus areas). */
  area?: string;
  /** Emphasises the chip, e.g. high impact. */
  strong?: boolean;
}

/**
 * The one control used for every option on a brain-dump task (P2-A6): a compact chip that opens a
 * short list. Same look, same keyboard behaviour (Enter/Space opens, arrows move, Enter picks).
 */
export function OptionChip<T extends string>({ label, value, options, onChange, icon, area, strong }: OptionChipProps<T>) {
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={cx("opt-chip", area && "is-tag", strong && "is-strong")} data-area={area} aria-label={`${label}: ${current?.label ?? value}`}>
        {area ? <span className="area-dot" aria-hidden /> : icon}
        <span className="opt-chip-text">{current?.label ?? value}</span>
        <ChevronDown size={13} aria-hidden className="opt-chip-caret" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu opt-menu" align="start" sideOffset={6}>
          <DropdownMenu.Label className="menu-label">{label}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
            {options.map((o) => (
              <DropdownMenu.RadioItem key={o.value} value={o.value} className="menu-item" data-area={o.area}>
                {o.area !== undefined && <span className="area-dot" aria-hidden />}
                <span className="menu-item-text">{o.label}</span>
                <DropdownMenu.ItemIndicator className="menu-check"><Check size={14} aria-hidden /></DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

interface DateChipProps {
  label: string;
  value: string | null;
  display: string;
  quickPicks: { label: string; date: string }[];
  onChange: (value: string | null) => void;
  icon?: ReactNode;
  warn?: boolean;
}

/** A chip that sets a date: quick picks, a calendar input, and Clear. */
export function DateChip({ label, value, display, quickPicks, onChange, icon, warn }: DateChipProps) {
  // Controlled, so a choice always closes the picker even when the choice re-renders the row it sits in.
  const [open, setOpen] = useState(false);
  const choose = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={cx("opt-chip", value === null && "is-empty", warn && "is-warn")} aria-label={`${label}: ${value ? display : "none"}`}>
        {icon}
        <span className="opt-chip-text">{display}</span>
        <ChevronDown size={13} aria-hidden className="opt-chip-caret" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu opt-menu date-pop" align="start" sideOffset={6} aria-label={label}>
          <span className="menu-label">{label}</span>
          {quickPicks.map((p) => (
            <button type="button" key={p.label} className={cx("menu-item", p.date === value && "is-on")} onClick={() => choose(p.date)}>
              <span className="menu-item-text">{p.label}</span>
              {p.date === value && <Check size={14} aria-hidden className="menu-check" />}
            </button>
          ))}
          <label className="date-pop-pick">
            <span>Pick a date</span>
            <input type="date" className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} onKeyDown={(e) => e.key === "Enter" && setOpen(false)} />
          </label>
          {value !== null && <button type="button" className="menu-item date-pop-clear" onClick={() => choose(null)}>No due date</button>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A short explanation shown on hover and on keyboard focus (never the only way to learn what a control does). */
export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tip" sideOffset={6} collisionPadding={12}>
            {content}
            <Tooltip.Arrow className="tip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
