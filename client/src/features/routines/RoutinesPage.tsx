import { Coffee } from "lucide-react";
import { ColorPicker } from "../../components/ColorPicker";
import { useToast } from "../../components/toast";
import { ErrorNote, PageHeader, Skeleton } from "../../components/ui";
import { errorMessage, type Area, type AreaColor } from "../../lib/api";
import { useDocumentTitle } from "../../lib/hooks";
import { useAreaMutations, useAreas, usePreferences, useSavePreferences } from "../../lib/queries";
import { RoutinesCard, YourDayCard } from "./RoutinesCard";

/**
 * Pre-planning (P2-E3): what every day already holds. Separate from the brain dump (capture) and
 * from Plan my day (choosing today's work) — set once here, applied automatically when planning.
 */
export function RoutinesPage() {
  useDocumentTitle("Routines");
  return (
    <>
      <PageHeader
        eyebrow="Pre-planning"
        title="Routines"
        sub="What every day already holds. Set it once; Plan my day works around it."
      />
      <div className="settings">
        <RoutinesCard />
        <BreaksCard />
        <YourDayCard />
      </div>
    </>
  );
}

const BREAKS = [0, 5, 10, 15, 20, 30];

/** Recovery breaks per focus area (P2-C4). A single task can override this when it is captured. */
function BreaksCard() {
  const areas = useAreas();
  const prefs = usePreferences();
  const savePrefs = useSavePreferences();
  const toast = useToast();
  const setBreakColor = (breakColor: AreaColor) =>
    prefs.data && savePrefs.mutate({ ...prefs.data, breakColor }, { onError: (err) => toast.error(errorMessage(err)) });
  return (
    <section className="card" aria-labelledby="breaks">
      <header className="card-head">
        <div>
          <h2 id="breaks">Recovery breaks</h2>
          <p>
            A short break reserved before or after work in an area, so rest is planned without extra effort. Breaks are
            not counted as work.
          </p>
        </div>
      </header>
      {areas.isPending ? (
        <Skeleton height={120} radius={10} />
      ) : areas.isError ? (
        <ErrorNote onRetry={() => areas.refetch()}>We could not load your focus areas.</ErrorNote>
      ) : areas.data.length === 0 ? (
        <p className="muted">Add focus areas in Settings first; breaks are set per area.</p>
      ) : (
        <ul className="break-list">
          {areas.data.map((a) => (
            <BreakRow key={a.id} area={a} />
          ))}
        </ul>
      )}
      {prefs.data && (
        <div className="field break-color">
          <span className="field-label">Colour of breaks on your calendar</span>
          <ColorPicker
            label="Colour of breaks on your calendar"
            value={prefs.data.breakColor ?? "green"}
            onChange={setBreakColor}
          />
        </div>
      )}
    </section>
  );
}

function BreakRow({ area }: { area: Area }) {
  const toast = useToast();
  const { update } = useAreaMutations();
  const set = (breakMinutes: number, breakPlacement: Area["breakPlacement"]) =>
    update.mutate(
      { id: area.id, name: area.name, color: area.color, breakMinutes, breakPlacement },
      { onError: (err) => toast.error(errorMessage(err)) },
    );
  const id = `break-${area.id}`;
  return (
    <li className="break-row" data-area={area.color}>
      <span className="area-dot" aria-hidden />
      <span className="break-name" id={id}>
        {area.name}
      </span>
      <select
        className="input break-select"
        aria-label={`Break length for ${area.name}`}
        value={area.breakMinutes}
        onChange={(e) => set(Number(e.target.value), area.breakPlacement)}
      >
        {BREAKS.map((m) => (
          <option key={m} value={m}>
            {m === 0 ? "No break" : `${m} min break`}
          </option>
        ))}
      </select>
      <select
        className="input break-select"
        aria-label={`When the break for ${area.name} happens`}
        value={area.breakPlacement}
        disabled={area.breakMinutes === 0}
        onChange={(e) => set(area.breakMinutes, e.target.value as Area["breakPlacement"])}
      >
        <option value="After">after the task</option>
        <option value="Before">before the task</option>
      </select>
      {area.breakMinutes > 0 && <Coffee size={15} className="break-icon" aria-hidden />}
    </li>
  );
}
