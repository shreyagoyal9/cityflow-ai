import type { Metadata } from "next";

import { EmployeeManager } from "@/components/municipal/employee-manager";
import { Card, CardHeader } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { requireMunicipal } from "@/lib/auth/municipal";
import { getCity } from "@/lib/cities";
import {
  listEmployeesWithWorkload,
  loadEmployeePerformance,
} from "@/lib/municipal/municipal-service";

export const metadata: Metadata = { title: "Workforce" };

/**
 * The municipal workforce, and how the work is going.
 *
 * A NOTE ON THE PERFORMANCE TABLE
 * These figures describe WORK, not people. Mean completion time depends far
 * more on what kind of defect somebody was given and where it is than on how
 * hard they worked, so the table is presented as a workload picture — useful
 * for spotting that one person is carrying twelve open jobs while another has
 * two — and explicitly not as a ranking.
 */
export default async function MunicipalEmployeesPage() {
  const user = await requireMunicipal();
  const city = getCity(user.cityCode);

  const [employees, performance] = await Promise.all([
    listEmployeesWithWorkload(city.code),
    loadEmployeePerformance(city.code),
  ]);

  return (
    <section className="py-8 sm:py-10">
      <Container width="wide">
        <SectionHeading
          eyebrow={city.name}
          title="Workforce"
          description="The inspectors and field workers who verify and repair road defects in this city."
        />

        <div className="mt-6">
          <EmployeeManager
            employees={employees.map((employee) => ({
              id: employee.id,
              staffCode: employee.staffCode,
              name: employee.name,
              phone: employee.phone,
              email: employee.email,
              assignedArea: employee.assignedArea,
              role: employee.role,
              isActive: employee.isActive,
              openIssues: employee.openIssues,
            }))}
          />
        </div>

        {/* -------------------------------------------------- workload table */}
        {performance.length > 0 && (
          <div className="mt-8">
            <Card>
              <CardHeader
                title="Workload"
                description="How work is distributed across active employees."
              />

              {/* Tables need their own horizontal scroll on a phone. */}
              <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead>
                    <tr className="border-b border-border-base text-left">
                      <th className="pb-2 font-medium text-muted">Employee</th>
                      <th className="pb-2 text-right font-medium text-muted">Open</th>
                      <th className="pb-2 text-right font-medium text-muted">Completed</th>
                      <th className="pb-2 text-right font-medium text-muted">Mean time</th>
                      <th className="pb-2 text-right font-medium text-muted">Past due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.map((row) => (
                      <tr key={row.employee.id} className="border-b border-border-base last:border-0">
                        <td className="py-2.5">
                          <span className="font-medium text-fg">{row.employee.name}</span>
                          <span className="ml-2 text-xs text-subtle">
                            {row.employee.staffCode}
                          </span>
                        </td>
                        <td className="py-2.5 text-right font-semibold text-fg">
                          {row.open}
                        </td>
                        <td className="py-2.5 text-right text-fg">{row.completed}</td>
                        <td className="py-2.5 text-right text-muted">
                          {row.meanHours === null ? "—" : `${row.meanHours} hr`}
                        </td>
                        <td className="py-2.5 text-right text-muted">
                          {row.lateCount > 0 ? row.lateCount : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-4 text-xs leading-relaxed text-subtle">
                These figures describe the work, not the people. How long a repair takes
                depends far more on the kind of defect and where it is than on who was
                assigned it, so this is a workload picture — useful for spotting an
                unbalanced queue — and not a ranking.
              </p>
            </Card>
          </div>
        )}
      </Container>
    </section>
  );
}
