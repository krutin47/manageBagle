using ManageBagle.Api.Data;

namespace ManageBagle.Api.Domain;

/// <summary>
/// A task may be worked on in several blocks. Finishing one session finishes the task only when no
/// other session is still open; otherwise the task stays in progress.
/// </summary>
public static class TaskCompletion
{
    public static bool IsOpen(ItemStatus status) => status is ItemStatus.Planned or ItemStatus.InProgress;

    /// <param name="otherSessions">Statuses of the task's other blocks, on any day.</param>
    public static ItemStatus AfterSessionFinished(ItemStatus current, IEnumerable<ItemStatus> otherSessions) =>
        otherSessions.Any(IsOpen)
            ? (current == ItemStatus.Planned ? ItemStatus.InProgress : current)
            : ItemStatus.Done;
}
