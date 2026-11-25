import { Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { AreaSelect, Button, Dialog, ErrorNote, Field, Input, OutsideToggle, Segmented, Textarea } from "../../components/ui";
import { useToast } from "../../components/toast";
import { ApiError, errorMessage, type Area, type Block, type BlockInput } from "../../lib/api";
import { modeLabel, PRIORITIES, STATUSES, statusLabel, WORK_MODES } from "../../lib/labels";
import { useBlockMutations } from "../../lib/queries";
import { formatDuration, fromMinutes, plannedMinutes, toMinutes, trimSeconds } from "../../lib/time";

export type BlockDraft = Partial<Block> & { date: string; start: string; end: string };

const DURATIONS = [15, 30, 45, 60, 90, 120];

export function BlockDialog({ draft, areas, onClose }: { draft: BlockDraft | null; areas: Area[]; onClose: () => void }) {
  return (
    <Dialog open={!!draft} onClose={onClose} title={draft?.id ? "Edit block" : "New time block"} description="Schedule the result, not just the topic.">
      {draft && <BlockForm key={draft.id ?? `${draft.date}-${draft.start}`} draft={draft} areas={areas} onClose={onClose} />}
    </Dialog>
  );
}

function BlockForm({ draft, areas, onClose }: { draft: BlockDraft; areas: Area[]; onClose: () => void }) {
  const toast = useToast();
  const { create, update, remove } = useBlockMutations();
  const [form, setForm] = useState<BlockInput>({
    date: draft.date,
    start: trimSeconds(draft.start),
    end: trimSeconds(draft.end),
    title: draft.title ?? "",
    focusAreaId: draft.focusAreaId ?? null,
    priority: draft.priority ?? "Medium",
    workMode: draft.workMode ?? "DeepFocus",
    status: draft.status ?? "Planned",
    actualMinutes: draft.actualMinutes ?? null,
    notes: draft.notes ?? "",
    isOutside: draft.isOutside ?? false,
  });
  const [error, setError] = useState<ApiError | null>(null);
  const patch = (p: Partial<BlockInput>) => setForm((f) => ({ ...f, ...p }));

  const planned = form.start && form.end ? plannedMinutes(form.start, form.end) : 0;
  const overnight = form.start && form.end ? toMinutes(form.end) < toMinutes(form.start) : false;
  const busy = create.isPending || update.isPending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (draft.id) await update.mutateAsync({ id: draft.id, ...form });
      else await create.mutateAsync(form);
      toast.success(draft.id ? "Block updated" : "Block added to your plan");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, errorMessage(err)));
    }
  };

  const destroy = async () => {
    try {
      await remove.mutateAsync(draft.id!);
      toast.success("Block deleted");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const hasFieldError = error && ["title", "start", "end", "actualMinutes"].some((f) => error.field(f));
  return (
    <form onSubmit={submit} noValidate>
      <div className="dialog-body form">
        {error && !hasFieldError && <ErrorNote>{error.message}</ErrorNote>}
        <Field label="Specific task or outcome" error={error?.field("title")}>
          {(p) => <Input {...p} autoFocus required maxLength={200} placeholder="e.g. Draft 400 words of the launch post" value={form.title} onChange={(e) => patch({ title: e.target.value })} />}
        </Field>

        <div className="form-grid-3">
          <Field label="Date">{(p) => <Input {...p} type="date" required value={form.date} onChange={(e) => patch({ date: e.target.value })} />}</Field>
          <Field label="Start" error={error?.field("start")}>{(p) => <Input {...p} type="time" step={300} required value={form.start} onChange={(e) => patch({ start: e.target.value })} />}</Field>
          <Field label="End" error={error?.field("end")}>{(p) => <Input {...p} type="time" step={300} required value={form.end} onChange={(e) => patch({ end: e.target.value })} />}</Field>
        </div>

        <div className="duration-row">
          <span className="duration-read" aria-live="polite">
            {planned > 0 ? <><strong>{formatDuration(planned)}</strong> planned{overnight && " · ends next day"}</> : "Pick a start and end"}
          </span>
          <span className="duration-chips" role="group" aria-label="Set length">
            {DURATIONS.map((d) => (
              <button key={d} type="button" className="chip-btn" aria-pressed={planned === d} onClick={() => form.start && patch({ end: fromMinutes(toMinutes(form.start) + d) })}>
                {formatDuration(d)}
              </button>
            ))}
          </span>
        </div>

        <div className="form-grid-2">
          <Field label="Focus area">{(p) => <AreaSelect {...p} areas={areas} value={form.focusAreaId} onChange={(focusAreaId) => patch({ focusAreaId })} />}</Field>
          <div className="field">
            <span className="field-label">Priority</span>
            <Segmented label="Priority" value={form.priority} onChange={(priority) => patch({ priority })} options={PRIORITIES.map((v) => ({ value: v, label: v }))} />
          </div>
        </div>

        <div className="field">
          <span className="field-label">Work mode</span>
          <Segmented size="sm" label="Work mode" value={form.workMode} onChange={(workMode) => patch({ workMode })} options={WORK_MODES.map((m) => ({ value: m, label: modeLabel[m] }))} />
        </div>

        <OutsideToggle checked={form.isOutside} onChange={(isOutside) => patch({ isOutside })} />

        <fieldset className="reality">
          <legend>Reality</legend>
          <div className="form-grid-2 reality-grid">
            <div className="field">
              <span className="field-label">Status</span>
              <Segmented size="sm" label="Status" value={form.status} onChange={(status) => patch({ status })} options={STATUSES.map((s) => ({ value: s, label: statusLabel[s] }))} />
            </div>
            <Field label="Actual minutes" optional hint="Leave empty until you have done it." error={error?.field("actualMinutes")}>
              {(p) => (
                <Input {...p} type="number" inputMode="numeric" min={0} max={1440} step={5} placeholder="—" value={form.actualMinutes ?? ""}
                  onChange={(e) => patch({ actualMinutes: e.target.value === "" ? null : Math.max(0, Math.min(1440, Math.round(Number(e.target.value)))) })} />
              )}
            </Field>
          </div>
        </fieldset>

        <Field label="Notes" optional>{(p) => <Textarea {...p} rows={2} maxLength={2000} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} />}</Field>
      </div>

      <footer className="dialog-foot">
        {draft.id && (
          <Button variant="ghost" className="push-left danger-text" icon={<Trash2 size={16} aria-hidden />} onClick={destroy} loading={remove.isPending}>
            Delete
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={planned === 0}>
          {draft.id ? "Save changes" : "Add block"}
        </Button>
      </footer>
    </form>
  );
}
