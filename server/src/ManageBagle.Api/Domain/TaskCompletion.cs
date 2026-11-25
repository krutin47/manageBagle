using ManageBagle.Api.Data;

namespace ManageBagle.Api.Domain;

/// <summary>What a task becomes when one of its sessions (blocks) changes, and whether it leaves the calendar.</summary>
public readonly record struct TaskTransition(ItemStatus Status, bool Unschedule);

/// <summary>
/// One task, one state everywhere (P2-G1). A task may be worked on in several blocks; this decides
/// the task's board column from what just happened to one of them.
/// </summary>
public static class TaskCompletion
{
    public static bool IsOpen(ItemStatus status) => status is ItemStatus.Planned or ItemStatus.InProgress;

    /// <param name="otherSessions">Statuses of the task's other blocks, on any day.</param>
    public static ItemStatus AfterSessionFinished(ItemStatus current, IEnumerable<ItemStatus> otherSessions) =>
        otherSessions.Any(IsOpen)
            ? (current == ItemStatus.Planned ? ItemStatus.InProgress : current)
            : ItemStatus.Done;

    /// <param name="task">The task's status now.</param>
    /// <param name="session">The block's new status. Skipped from Today means "put off", not dropped.</param>
    /// <param name="otherSessions">Statuses of the task's other blocks.</param>
    /// <param name="worked">Whether any time was recorded on this block.</param>
    public static TaskTransition AfterSessionChanged(ItemStatus task, ItemStatus session, IEnumerable<ItemStatus> otherSessions, bool worked)
    {
        var others = otherSessions.ToList();
        return session switch
        {
            ItemStatus.Done => new(AfterSessionFinished(task, others), false),
            // Started: the task is under way.
            ItemStatus.InProgress => new(task is ItemStatus.Planned or ItemStatus.Done ? ItemStatus.InProgress : task, false),
            // Reopened: a finished task is not finished any more.
            ItemStatus.Planned => new(task == ItemStatus.Done ? (worked || others.Any(s => s == ItemStatus.Done) ? ItemStatus.InProgress : ItemStatus.Planned) : task, false),
            // Put off: back to the backlog unless another session still holds it on the calendar. A dropped task stays dropped.
            _ => task is ItemStatus.Done or ItemStatus.Skipped || others.Any(IsOpen)
                ? new(task, false)
                : new(worked || others.Any(s => s == ItemStatus.Done) ? ItemStatus.InProgress : ItemStatus.Planned, true),
        };
    }
}
