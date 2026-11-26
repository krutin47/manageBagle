import { Check } from "lucide-react";
import type { AreaColor } from "../lib/api";
import { AREA_COLORS, colorLabel } from "../lib/labels";

/**
 * Picks from the contrast-tested palette only (tokens.css), so any choice keeps text readable.
 * With `noneLabel`, a neutral "default" choice comes first and maps to null.
 */
export function ColorPicker<T extends AreaColor | null>({
  value,
  onChange,
  label,
  noneLabel,
}: {
  value: T;
  onChange: (c: T) => void;
  label: string;
  noneLabel?: string;
}) {
  const options: (AreaColor | null)[] = noneLabel ? [null, ...AREA_COLORS] : AREA_COLORS;
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {options.map((c) => (
        <button
          key={c ?? "none"}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c ? colorLabel[c] : noneLabel}
          title={c ? colorLabel[c] : noneLabel}
          className="swatch"
          data-area={c ?? "none"}
          onClick={() => onChange(c as T)}
        >
          {c === value && <Check size={12} strokeWidth={3.5} aria-hidden />}
        </button>
      ))}
    </div>
  );
}
