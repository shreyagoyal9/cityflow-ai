"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice, TextField } from "@/components/ui/input";

/**
 * Moving a road issue through the repair workflow.
 *
 * Only the transitions the state machine actually permits are offered, so an
 * officer cannot be refused after filling in a form. The server re-checks —
 * this component is a convenience, never the enforcement.
 *
 * Rejecting an issue requires a written reason. "This is not a real defect" is
 * a judgement somebody should have to justify, and those notes are also the
 * only way the sensor detection threshold ever gets better.
 */

export interface StatusOption {
  value: string;
  label: string;
  description: string;
}

export interface EmployeeOption {
  id: string;
  name: string;
  staffCode: string;
  assignedArea: string | null;
  openIssues: number;
}

export function StatusActions({
  issueId,
  currentStatus,
  options,
  employees,
}: {
  issueId: string;
  currentStatus: string;
  options: StatusOption[];
  employees: EmployeeOption[];
}) {
  const router = useRouter();

  const [selected, setSelected] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const needsEmployee = selected === "ASSIGNED";
  const needsNote = selected === "REJECTED";

  async function submit() {
    if (!selected) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/municipal/issues/${issueId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: selected,
          employeeId: employeeId || undefined,
          dueAt: dueAt || undefined,
          note: note || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Could not update this issue.");
        return;
      }

      setSelected(null);
      setEmployeeId("");
      setDueAt("");
      setNote("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (options.length === 0) {
    return (
      <Card>
        <CardHeader title="Next steps" />
        <p className="text-sm leading-relaxed text-muted">
          This issue is closed and signed off. If the defect has returned, it should be
          raised as a new issue at the same location — that is also how repeat failures at
          one spot become visible.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Next steps"
        description={`Currently ${currentStatus.toLowerCase().replace(/_/g, " ")}.`}
      />

      {error && (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <div className="space-y-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={
              selected === option.value
                ? "flex cursor-pointer gap-3 rounded-lg border-2 border-primary bg-primary-soft p-3"
                : "flex cursor-pointer gap-3 rounded-lg border border-border-base bg-surface p-3 hover:bg-surface-2"
            }
          >
            <input
              type="radio"
              name="next-status"
              value={option.value}
              checked={selected === option.value}
              onChange={() => {
                setSelected(option.value);
                setError(null);
              }}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--cf-primary)]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg">{option.label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </div>

      {selected && (
        <div className="mt-5 space-y-4 border-t border-border-base pt-5">
          {needsEmployee && (
            <div>
              <label
                htmlFor="assign-employee"
                className="mb-1.5 block text-sm font-medium text-fg"
              >
                Assign to
                <span className="ml-1 text-danger" aria-hidden="true">
                  *
                </span>
              </label>

              {employees.length === 0 ? (
                <Notice tone="error">
                  There are no active employees in this city yet. Add one on the Workforce
                  page before assigning work.
                </Notice>
              ) : (
                <>
                  <select
                    id="assign-employee"
                    value={employeeId}
                    onChange={(event) => setEmployeeId(event.target.value)}
                    className="h-11 w-full rounded-lg border border-border-base bg-surface px-3 text-sm text-fg"
                  >
                    <option value="">Choose an employee…</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name} ({employee.staffCode}) — {employee.openIssues} open
                        {employee.assignedArea ? ` · ${employee.assignedArea}` : ""}
                      </option>
                    ))}
                  </select>
                  {/* Current workload is shown in the option itself so work is
                      not piled onto whoever happens to be first alphabetically. */}
                  <p className="mt-1.5 text-xs text-subtle">
                    The number after each name is how much open work they already hold.
                  </p>
                </>
              )}

              <div className="mt-4">
                <TextField
                  label="Due date"
                  type="date"
                  hint="Optional. Overdue work is flagged on the overview."
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="status-note" className="mb-1.5 block text-sm font-medium text-fg">
              {needsNote ? "Why is this not a real defect?" : "Note"}
              {needsNote && (
                <span className="ml-1 text-danger" aria-hidden="true">
                  *
                </span>
              )}
            </label>
            <textarea
              id="status-note"
              rows={3}
              maxLength={600}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                needsNote
                  ? "e.g. Inspected 12 March — this is a marked speed breaker, not a defect."
                  : "Anything worth recording about this step."
              }
              className="w-full rounded-lg border border-border-base bg-surface px-3 py-2 text-sm text-fg"
            />
            {needsNote && (
              <p className="mt-1.5 text-xs text-subtle">
                Kept as a permanent record, and used to improve the detection threshold.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={submit}
              loading={saving}
              disabled={
                (needsEmployee && !employeeId) || (needsNote && note.trim().length < 5)
              }
            >
              Confirm
            </Button>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
