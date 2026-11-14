import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from "@dnd-kit/core";
import { CalendarPlus, MapPin } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { AreaChip, cx, PriorityMark } from "../../components/ui";
import type { Area, Status, Task } from "../../lib/api";
import { modeLabel } from "../../lib/labels";
import { formatDate, formatDuration, todayISO } from "../../lib/time";

const COLUMNS: { status: Status; title: string; empty: string }[] = [
  { status: "Planned", title: "To do", empty: "Nothing waiting." },
  { status: "InProgress", title: "In progress", empty: "Drag a task here when you start it." },
  { status: "Done", title: "Done", empty: "Finished work lands here." },
  { status: "Skipped", title: "Dropped", empty: "For things you decided not to do." },
];

const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };

/** The column under the pointer; for keyboard moves (no pointer), the column the card overlaps most. */
const columnUnder: CollisionDetection = (args) => {
  const hit = pointerWithin(args);
  return hit.length > 0 ? hit : rectIntersection(args);
};

interface BoardProps {
  tasks: Task[];
  areaById: Map<string, Area>;
  onMove: (task: Task, status: Status) => void;
  onOpen: (task: Task) => void;
  onSchedule: (task: Task) => void;
}

export function Board({ tasks, areaById, onMove, onOpen, onSchedule }: BoardProps) {
  const [dragging, setDragging] = useState<Task | null>(null);
  // A small drag distance keeps a plain click (open the task) from starting a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const task = tasks.find((t) => t.id === e.active.id);
    const status = e.over?.id as Status | undefined;
    if (task && status && status !== task.status) onMove(task, status);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={columnUnder}
      onDragStart={(e) => setDragging(tasks.find((t) => t.id === e.active.id) ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${tasks.find((t) => t.id === active.id)?.title}.`,
          onDragOver: ({ over }) => (over ? `Over ${COLUMNS.find((c) => c.status === over.id)?.title}.` : ""),
          onDragEnd: ({ over }) => (over ? `Dropped in ${COLUMNS.find((c) => c.status === over.id)?.title}.` : "Dropped."),
          onDragCancel: () => "Move cancelled.",
        },
        screenReaderInstructions: { draggable: "Press space to pick up the task, arrow keys to move it between columns, space to drop, escape to cancel." },
      }}
    >
      <div className="board">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => t.status === col.status).sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt.localeCompare(b.createdAt));
          return (
            <Column key={col.status} status={col.status} title={col.title} empty={col.empty} count={items.length} minutes={items.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0)} active={!!dragging && dragging.status !== col.status}>
              {items.map((t) => (
                <Card key={t.id} task={t} area={t.focusAreaId ? areaById.get(t.focusAreaId) : undefined} hidden={dragging?.id === t.id} onOpen={() => onOpen(t)} onSchedule={() => onSchedule(t)} />
              ))}
            </Column>
          );
        })}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>
        {dragging && <CardBody task={dragging} area={dragging.focusAreaId ? areaById.get(dragging.focusAreaId) : undefined} lifted />}
      </DragOverlay>
    </DndContext>
  );
}

function Column({ status, title, empty, count, minutes, active, children }: { status: Status; title: string; empty: string; count: number; minutes: number; active: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section ref={setNodeRef} className={cx("board-col", active && "is-target", isOver && "is-over")} data-status={status} aria-label={`${title}, ${count} task${count === 1 ? "" : "s"}`}>
      <header className="board-col-head">
        <h2>{title}</h2>
        <span className="board-count">{count}</span>
        {minutes > 0 && status !== "Done" && status !== "Skipped" && <span className="board-mins">{formatDuration(minutes)}</span>}
      </header>
      <div className="board-cards">
        {children}
        {count === 0 && <p className="board-empty">{empty}</p>}
      </div>
    </section>
  );
}

function Card({ task, area, hidden, onOpen, onSchedule }: { task: Task; area?: Area; hidden: boolean; onOpen: () => void; onSchedule: () => void }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: task.id });
  return (
    <motion.div ref={setNodeRef} layout="position" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: hidden ? 0.25 : 1, scale: 1 }} transition={{ duration: 0.18 }} {...attributes} {...listeners} aria-roledescription="draggable task" className="board-card-wrap">
      <CardBody task={task} area={area} onOpen={onOpen} onSchedule={onSchedule} />
    </motion.div>
  );
}

function CardBody({ task, area, lifted, onOpen, onSchedule }: { task: Task; area?: Area; lifted?: boolean; onOpen?: () => void; onSchedule?: () => void }) {
  const open = task.status === "Planned" || task.status === "InProgress";
  const late = open && task.dueDate !== null && task.dueDate < todayISO();
  return (
    <article className={cx("board-card", lifted && "is-lifted", !open && "is-closed")} data-area={area?.color ?? "none"}>
      <button type="button" className="row-link board-card-title" onClick={onOpen} tabIndex={lifted ? -1 : 0}>
        {task.title}
      </button>
      {task.nextStep && <p className="board-card-next">Next: {task.nextStep}</p>}
      <div className="board-card-meta">
        <AreaChip area={area} compact />
        <PriorityMark priority={task.priority} />
        {task.impact === "High" && <span className="impact-tag is-high">High impact</span>}
      </div>
      <div className="board-card-foot">
        <span>
          {task.estimatedMinutes !== null && <>{formatDuration(task.estimatedMinutes)} · </>}
          {modeLabel[task.workMode]}
          {task.isOutside && <span className="outside-tag"> · <MapPin size={12} aria-hidden /> outside</span>}
        </span>
        {task.dueDate && <span className={cx("due", late && "is-late")}>{late ? "Overdue" : "Due"} {formatDate(task.dueDate, "short")}</span>}
      </div>
      {open && (task.scheduledDate ? (
        <span className="scheduled board-card-when"><CalendarPlus size={12} aria-hidden /> {formatDate(task.scheduledDate, "medium")}</span>
      ) : (
        <button type="button" className="board-card-book" onClick={onSchedule} tabIndex={lifted ? -1 : 0}><CalendarPlus size={13} aria-hidden /> Schedule</button>
      ))}
    </article>
  );
}
