import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";

export const instant = false;

export default async function AdminDashboardPage() {
  const session = await auth();

  if (!session?.user) redirect("/login");
  if (session.user.role === "CANDIDATE") redirect("/dashboard");
  if (session.user.role === "INTERVIEWER") redirect("/interviewer");

  const [
    usersCount,
    candidatesCount,
    interviewersCount,
    interviewsCount,
    liveCount,
    completedCount,
    reportsCount,
    latestInterviews,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: "CANDIDATE" } }),
    prisma.user.count({ where: { role: "INTERVIEWER" } }),
    prisma.interview.count(),
    prisma.interview.count({ where: { status: "LIVE" } }),
    prisma.interview.count({ where: { status: "COMPLETED" } }),
    prisma.interviewReport.count(),
    prisma.interview.findMany({
      orderBy: { updatedAt: "desc" },
      take: 8,
      include: {
        createdBy: { select: { name: true, email: true } },
        participants: {
          where: { role: "CANDIDATE" },
          include: { user: { select: { name: true, email: true } } },
        },
        report: { select: { overallScore: true } },
      },
    }),
  ]);

  const stats = [
    { label: "Registered users", value: usersCount, detail: `${candidatesCount} candidates · ${interviewersCount} interviewers` },
    { label: "Total interviews", value: interviewsCount, detail: `${liveCount} live right now` },
    { label: "Completed interviews", value: completedCount, detail: "Sessions marked completed" },
    { label: "Generated reports", value: reportsCount, detail: "Saved final interview reports" },
  ];

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-semibold text-red-600">Administration</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Admin Dashboard</h1>
            <p className="mt-2 text-slate-600">Welcome, {session.user.name ?? "Admin"}. Monitor users, interviews, and reports.</p>
          </div>
          <Link href="/interviewer" className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100">
            Interviewer workspace
          </Link>
        </header>

        <section aria-label="Platform statistics" className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <article key={stat.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">{stat.label}</p>
              <p className="mt-3 text-3xl font-bold tabular-nums text-slate-900">{stat.value}</p>
              <p className="mt-2 text-xs text-slate-500">{stat.detail}</p>
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col justify-between gap-2 border-b border-slate-100 p-5 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Recent interview activity</h2>
              <p className="mt-1 text-sm text-slate-500">The latest sessions across the platform.</p>
            </div>
            <span className="text-xs text-slate-500">{interviewsCount} total sessions</span>
          </div>

          {latestInterviews.length === 0 ? (
            <div className="p-10 text-center">
              <p className="font-medium text-slate-800">No interviews yet</p>
              <p className="mt-1 text-sm text-slate-500">Interview activity will appear here when sessions are created.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Interview</th>
                    <th className="px-5 py-3 font-semibold">Candidate</th>
                    <th className="px-5 py-3 font-semibold">Interviewer</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Score</th>
                    <th className="px-5 py-3 font-semibold">Open</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {latestInterviews.map((interview) => {
                    const candidate = interview.participants[0]?.user;
                    return (
                      <tr key={interview.id} className="hover:bg-slate-50/70">
                        <td className="px-5 py-4">
                          <p className="font-semibold text-slate-900">{interview.title}</p>
                          <p className="mt-1 text-xs text-slate-500">{interview.jobTitle}</p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-slate-800">{candidate?.name ?? "Not assigned"}</p>
                          <p className="mt-1 text-xs text-slate-500">{candidate?.email ?? "—"}</p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-slate-800">{interview.createdBy.name ?? "Unknown"}</p>
                          <p className="mt-1 text-xs text-slate-500">{interview.createdBy.email}</p>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            interview.status === "COMPLETED" ? "bg-emerald-100 text-emerald-700" :
                            interview.status === "LIVE" ? "bg-blue-100 text-blue-700" :
                            interview.status === "CANCELLED" ? "bg-red-100 text-red-700" :
                            "bg-slate-100 text-slate-700"
                          }`}>{interview.status}</span>
                        </td>
                        <td className="px-5 py-4 tabular-nums text-slate-700">
                          {interview.report?.overallScore == null ? "—" : `${interview.report.overallScore}/10`}
                        </td>
                        <td className="px-5 py-4">
                          <Link href={`/interview/${interview.id}`} className="font-medium text-blue-600 hover:text-blue-800">
                            View session
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <article className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">User management</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Current account counts: {candidatesCount} candidates and {interviewersCount} interviewers.</p>
            <p className="mt-3 text-xs text-slate-400">Dedicated role and account editing tools remain in the security phase.</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Interview monitoring</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Review status, assigned participants, and completed-session scores from the activity table above.</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Report monitoring</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{reportsCount} report(s) are stored. Interview participants and the creating interviewer can open authorized sessions.</p>
          </article>
        </section>
      </div>
    </main>
  );
}
