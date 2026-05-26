import { useEffect, useMemo, useState, type FormEvent } from "react"
import { LeoBadge, LeoButton, LeoIcon, LeoIconButton } from "../../components/leo"
import { openExternalLink } from "../../lib/open-url"

const TASKS_URL = "https://cal.fly.pm/tasks"

interface SharedTask {
  id: string
  title: string
  startDate: string | null
  scheduledTime: string | null
  plannedTime: number
  completed: boolean
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10)
}

function taskDate(task: SharedTask): string {
  return task.startDate?.slice(0, 10) ?? ""
}

function taskMeta(task: SharedTask): string | null {
  const pieces = [
    taskDate(task),
    task.scheduledTime,
    task.plannedTime > 0 ? `${task.plannedTime}m` : null
  ].filter(Boolean)
  return pieces.length ? pieces.join(" / ") : null
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && typeof init.body === "string" && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }
  const response = await chrome.runtime.sendMessage({
    type: "TASKS_API_REQUEST",
    path,
    init: {
      method: init.method,
      headers: Object.fromEntries(headers.entries()),
      body: typeof init.body === "string" ? init.body : undefined
    }
  })
  if (!response?.ok) {
    throw new Error(response?.error || `Task request failed: ${response?.status ?? "unknown"}`)
  }
  return response.data as T
}

export function TasksSection() {
  const [tasks, setTasks] = useState<SharedTask[]>([])
  const [title, setTitle] = useState("")
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [minutes, setMinutes] = useState("30")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const incomplete = useMemo(() => tasks.filter((task) => !task.completed), [tasks])
  const completed = useMemo(() => tasks.filter((task) => task.completed), [tasks])

  async function loadTasks() {
    setLoading(true)
    setError(null)
    try {
      const data = await requestJson<{ tasks?: SharedTask[] }>("/tasks-data")
      setTasks(data.tasks ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTasks()
  }, [])

  async function addTask(event: FormEvent) {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle || saving) return
    setSaving(true)
    setError(null)
    try {
      const scheduledTime = time || null
      const taskDateValue = date || (scheduledTime ? todayInputValue() : null)
      const plannedTime = Number.parseInt(minutes, 10)
      const data = await requestJson<{ task?: SharedTask }>("/tasks-data", {
        method: "POST",
        body: JSON.stringify({
          title: trimmedTitle,
          date: taskDateValue,
          scheduledTime,
          plannedTime: Number.isFinite(plannedTime) ? plannedTime : scheduledTime ? 30 : 0
        })
      })
      if (data.task) setTasks((current) => [data.task!, ...current])
      setTitle("")
      setDate("")
      setTime("")
      setMinutes("30")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add task")
    } finally {
      setSaving(false)
    }
  }

  async function toggleTask(task: SharedTask) {
    setError(null)
    try {
      const data = await requestJson<{ task?: SharedTask }>(
        `/tasks-data/${encodeURIComponent(task.id)}/complete`,
        { method: "POST" }
      )
      if (data.task) {
        setTasks((current) => current.map((item) => (item.id === task.id ? data.task! : item)))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update task")
    }
  }

  async function deleteTask(task: SharedTask) {
    setError(null)
    try {
      await requestJson<{ ok: boolean }>(`/tasks-data/${encodeURIComponent(task.id)}`, {
        method: "DELETE"
      })
      setTasks((current) => current.filter((item) => item.id !== task.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete task")
    }
  }

  const orderedTasks = [...incomplete, ...completed]

  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden" data-testid="tasks-section">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-fg">Tasks</h1>
          <p className="truncate text-[11px] text-fg/45">Timed items appear on Calendar.</p>
        </div>
        <a
          href={TASKS_URL}
          onClick={openExternalLink(TASKS_URL)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded text-fg/45 transition-colors hover:bg-accent hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          title="Open cal.fly.pm/tasks"
          aria-label="Open cal.fly.pm/tasks"
        >
          <LeoIcon name="file-export" size={15} />
        </a>
      </header>

      <form className="border-b border-border/70 p-3" onSubmit={addTask}>
        <div className="space-y-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            placeholder="Add a task..."
            aria-label="Task title"
            maxLength={200}
            className="h-9 w-full rounded border border-input bg-card px-2.5 text-sm text-fg placeholder:text-fg/35 focus:border-primary focus:outline-none"
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.currentTarget.value)}
              aria-label="Task date"
              className="h-8 min-w-0 rounded border border-input bg-card px-2 text-xs text-fg focus:border-primary focus:outline-none"
            />
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.currentTarget.value)}
              aria-label="Task time"
              className="h-8 min-w-0 rounded border border-input bg-card px-2 text-xs text-fg focus:border-primary focus:outline-none"
            />
            <input
              type="number"
              value={minutes}
              onChange={(event) => setMinutes(event.currentTarget.value)}
              aria-label="Minutes"
              min={0}
              max={1440}
              step={15}
              className="h-8 min-w-0 rounded border border-input bg-card px-2 text-xs text-fg focus:border-primary focus:outline-none"
            />
          </div>
          <LeoButton className="w-full" disabled={!title.trim() || saving} type="submit" variant="primary">
            {saving ? "Adding..." : "Add"}
          </LeoButton>
        </div>
      </form>

      {error && (
        <div className="border-b border-error/20 bg-error/10 px-4 py-2 text-xs text-error">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? <p className="text-xs text-fg/45">Loading tasks...</p> : null}
        {!loading && orderedTasks.length === 0 ? <p className="text-xs text-fg/45">No tasks yet.</p> : null}
        <div className="space-y-2">
          {orderedTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={() => void toggleTask(task)}
              onDelete={() => void deleteTask(task)}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function TaskRow({
  task,
  onToggle,
  onDelete
}: {
  task: SharedTask
  onToggle: () => void
  onDelete: () => void
}) {
  const meta = taskMeta(task)
  return (
    <div className="group flex min-w-0 items-start gap-2 rounded border border-border/70 bg-card/45 p-2">
      <input
        type="checkbox"
        checked={task.completed}
        onChange={onToggle}
        aria-label={task.completed ? "Mark incomplete" : "Mark complete"}
        className="mt-1 h-4 w-4 shrink-0 accent-primary"
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${task.completed ? "text-fg/45 line-through" : "text-fg"}`}>
          {task.title}
        </p>
        {meta ? (
          <LeoBadge className="mt-1" variant={task.completed ? "neutral" : "info"}>
            {meta}
          </LeoBadge>
        ) : null}
      </div>
      <LeoIconButton
        aria-label="Delete task"
        className="shrink-0 text-fg/35 hover:text-destructive"
        icon="trash"
        iconSize={13}
        onClick={onDelete}
        title="Delete task"
        variant="ghost"
      />
    </div>
  )
}
