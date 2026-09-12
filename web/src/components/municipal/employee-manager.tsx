"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ChoiceGroup, Toggle } from "@/components/ui/choice-group";
import { Notice, TextField } from "@/components/ui/input";

/**
 * The municipal workforce: add, edit and deactivate employees.
 *
 * DEACTIVATE, NOT DELETE.
 * An employee's name appears in the audit trail of every issue they touched.
 * Removing the record would leave those entries pointing at nobody, which is
 * exactly what an audit trail exists to prevent. Deactivating keeps the history
 * and takes them out of the assignment picker — and is refused while they still
 * hold open work, because silently orphaning assigned repairs is how jobs get
 * lost.
 */

const ROLES = [
  {
    value: "FIELD_WORKER" as const,
    label: "Field worker",
    hint: "Carries out repairs",
  },
  {
    value: "INSPECTOR" as const,
    label: "Inspector",
    hint: "Verifies defects and signs off work",
  },
  {
    value: "SUPERVISOR" as const,
    label: "Supervisor",
    hint: "Assigns work and manages a team",
  },
];

export interface EmployeeRow {
  id: string;
  staffCode: string;
  name: string;
  phone: string | null;
  email: string | null;
  assignedArea: string | null;
  role: "FIELD_WORKER" | "INSPECTOR" | "SUPERVISOR";
  isActive: boolean;
  openIssues: number;
}

interface FormValues {
  staffCode: string;
  name: string;
  phone: string;
  email: string;
  assignedArea: string;
  role: EmployeeRow["role"];
  isActive: boolean;
}

const EMPTY: FormValues = {
  staffCode: "",
  name: "",
  phone: "",
  email: "",
  assignedArea: "",
  role: "FIELD_WORKER",
  isActive: true,
};

export function EmployeeManager({ employees }: { employees: EmployeeRow[] }) {
  const router = useRouter();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function startAdd() {
    setValues(EMPTY);
    setEditingId(null);
    setFieldErrors({});
    setError(null);
    setShowForm(true);
  }

  function startEdit(employee: EmployeeRow) {
    setValues({
      staffCode: employee.staffCode,
      name: employee.name,
      phone: employee.phone ?? "",
      email: employee.email ?? "",
      assignedArea: employee.assignedArea ?? "",
      role: employee.role,
      isActive: employee.isActive,
    });
    setEditingId(employee.id);
    setFieldErrors({});
    setError(null);
    setShowForm(true);
  }

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch(
        editingId ? `/api/municipal/employees/${editingId}` : "/api/municipal/employees",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Could not save this employee.");
        setFieldErrors(data.fieldErrors ?? {});
        return;
      }

      setShowForm(false);
      setEditingId(null);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(employee: EmployeeRow) {
    setBusyId(employee.id);
    setError(null);

    try {
      const response = await fetch(`/api/municipal/employees/${employee.id}`, {
        method: "DELETE",
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Could not deactivate this employee.");
        return;
      }

      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {error && <Notice tone="error">{error}</Notice>}

      {!showForm && (
        <Button onClick={startAdd}>Add an employee</Button>
      )}

      {showForm && (
        <Card>
          <CardHeader
            title={editingId ? "Edit employee" : "Add an employee"}
            description="Staff numbers are unique within a city."
          />

          <form onSubmit={submit} className="space-y-5" noValidate>
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label="Staff number"
                hint="Letters, numbers and hyphens, e.g. BMC-1742"
                value={values.staffCode}
                onChange={(event) => set("staffCode", event.target.value)}
                error={fieldErrors.staffCode}
                required
              />
              <TextField
                label="Full name"
                value={values.name}
                onChange={(event) => set("name", event.target.value)}
                error={fieldErrors.name}
                required
              />
              <TextField
                label="Mobile number"
                hint="Optional"
                value={values.phone}
                onChange={(event) => set("phone", event.target.value)}
                error={fieldErrors.phone}
              />
              <TextField
                label="Email"
                type="email"
                hint="Optional"
                value={values.email}
                onChange={(event) => set("email", event.target.value)}
                error={fieldErrors.email}
              />
            </div>

            <TextField
              label="Area covered"
              hint="Optional, e.g. Zone 4 — North. Helps route work to whoever is nearest."
              value={values.assignedArea}
              onChange={(event) => set("assignedArea", event.target.value)}
              error={fieldErrors.assignedArea}
            />

            <ChoiceGroup
              legend="Role"
              choices={ROLES}
              value={values.role}
              onChange={(value) => set("role", value)}
              columns={3}
            />

            <Toggle
              label="Currently active"
              description="Inactive employees keep their history but cannot be assigned new work."
              checked={values.isActive}
              onChange={(checked) => set("isActive", checked)}
            />

            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={saving}>
                {editingId ? "Save changes" : "Add employee"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* ------------------------------------------------------------- list */}
      {employees.length === 0 ? (
        <Card>
          <p className="text-base font-medium text-fg">No employees yet</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Road issues cannot be assigned until there is somebody to assign them to. Add
            the field workers and inspectors who cover this city.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {employees.map((employee) => (
            <li
              key={employee.id}
              className={
                employee.isActive
                  ? "rounded-card border border-border-base bg-surface p-4 shadow-card"
                  : "rounded-card border border-border-base bg-surface-2 p-4"
              }
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-fg">{employee.name}</h3>
                    <Badge tone="neutral">{employee.staffCode}</Badge>
                    <Badge tone={employee.role === "SUPERVISOR" ? "primary" : "secondary"}>
                      {ROLES.find((role) => role.value === employee.role)?.label}
                    </Badge>
                    {!employee.isActive && <Badge tone="neutral">Inactive</Badge>}
                  </div>

                  <p className="mt-1.5 text-sm text-muted">
                    {employee.assignedArea ?? "No area assigned"}
                    {employee.phone && (
                      <>
                        <span className="mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        {employee.phone}
                      </>
                    )}
                  </p>

                  <p className="mt-1 text-sm text-fg">
                    <span className="font-semibold">{employee.openIssues}</span> open{" "}
                    {employee.openIssues === 1 ? "job" : "jobs"}
                  </p>
                </div>

                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => startEdit(employee)}>
                    Edit
                  </Button>
                  {employee.isActive && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deactivate(employee)}
                      loading={busyId === employee.id}
                    >
                      Deactivate
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
