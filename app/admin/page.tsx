import { auth } from "@/auth";
import { redirect } from "next/navigation";

export const instant = false;

export default async function AdminDashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role === "CANDIDATE") {
    redirect("/dashboard");
  }

  if (session.user.role === "INTERVIEWER") {
    redirect("/interviewer");
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8">
          <p className="text-sm font-medium text-red-600">
            Administration
          </p>

          <h1 className="mt-2 text-3xl font-bold text-slate-900">
            Admin Dashboard
          </h1>

          <p className="mt-2 text-slate-600">
            Welcome, {session.user.name ?? "Admin"}.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">
              Users
            </h2>

            <p className="mt-2 text-3xl font-bold text-slate-900">
              0
            </p>

            <p className="mt-1 text-sm text-slate-600">
              Registered users
            </p>
          </div>

          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">
              Interviews
            </h2>

            <p className="mt-2 text-3xl font-bold text-slate-900">
              0
            </p>

            <p className="mt-1 text-sm text-slate-600">
              Total interview sessions
            </p>
          </div>

          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">
              Reports
            </h2>

            <p className="mt-2 text-3xl font-bold text-slate-900">
              0
            </p>

            <p className="mt-1 text-sm text-slate-600">
              Generated reports
            </p>
          </div>
        </div>

        <section className="mt-8 rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">
            Administration
          </h2>

          <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border p-4">
              <p className="font-medium text-slate-900">
                User Management
              </p>

              <p className="mt-1 text-sm text-slate-500">
                Manage candidates, interviewers and admins.
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="font-medium text-slate-900">
                Interview Management
              </p>

              <p className="mt-1 text-sm text-slate-500">
                Monitor all interview sessions.
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="font-medium text-slate-900">
                Reports
              </p>

              <p className="mt-1 text-sm text-slate-500">
                Review generated interview reports.
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="font-medium text-slate-900">
                System Settings
              </p>

              <p className="mt-1 text-sm text-slate-500">
                Configure platform settings.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}