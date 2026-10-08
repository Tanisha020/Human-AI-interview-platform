import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";

export const instant = false;

export default async function InterviewerDashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role === "CANDIDATE") {
    redirect("/dashboard");
  }

  if (session.user.role === "ADMIN") {
    redirect("/admin");
  }

  const interviews = await prisma.interview.findMany({
    where: {
      createdById: session.user.id,
    },
    orderBy: {
      scheduledAt: "asc",
    },
    include: {
      participants: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  const upcomingInterviews = interviews.filter(
    (interview) => interview.status === "SCHEDULED",
  );

  const completedInterviews = interviews.filter(
    (interview) => interview.status === "COMPLETED",
  );

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-6 py-10">
        {/* Header */}
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-medium text-blue-600">
              Interviewer Portal
            </p>

            <h1 className="mt-1 text-3xl font-bold text-slate-900">
              Interviewer Dashboard
            </h1>

            <p className="mt-2 text-slate-600">
              Welcome, {session.user.name ?? "Interviewer"}.
            </p>
          </div>

          <Link
            href="/interviewer/interviews/new"
            className="inline-block rounded-lg bg-blue-600 px-5 py-3 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Create Interview
          </Link>
        </div>

        {/* Stats */}
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Upcoming Interviews</p>

            <p className="mt-2 text-3xl font-bold text-slate-900">
              {upcomingInterviews.length}
            </p>
          </div>

          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Completed Interviews</p>

            <p className="mt-2 text-3xl font-bold text-slate-900">
              {completedInterviews.length}
            </p>
          </div>

          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Total Interviews</p>

            <p className="mt-2 text-3xl font-bold text-slate-900">
              {interviews.length}
            </p>
          </div>
        </div>

        {/* Upcoming Interviews */}
        <section className="mt-10">
          <div className="mb-5">
            <h2 className="text-xl font-bold text-slate-900">
              Your Interviews
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Interviews created by you.
            </p>
          </div>

          {interviews.length === 0 ? (
            <div className="rounded-xl border bg-white p-10 text-center shadow-sm">
              <p className="font-medium text-slate-900">No interviews yet</p>

              <p className="mt-2 text-sm text-slate-500">
                Create your first interview to get started.
              </p>

              <Link
                href="/interviewer/interviews/new"
                className="mt-5 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Create Interview
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {interviews.map((interview) => {
                const candidate = interview.participants.find(
                  (participant) => participant.role === "CANDIDATE",
                )?.user;

                return (
                  <div
                    key={interview.id}
                    className="rounded-xl border bg-white p-6 shadow-sm"
                  >
                    <div className="flex flex-col justify-between gap-5 lg:flex-row">
                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="text-lg font-bold text-slate-900">
                            {interview.title}
                          </h3>

                          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                            {interview.status}
                          </span>

                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                            {interview.difficulty}
                          </span>
                        </div>

                        <p className="mt-2 text-sm text-slate-600">
                          {interview.jobTitle}
                        </p>

                        <div className="mt-4 space-y-1 text-sm text-slate-600">
                          <p>
                            <span className="font-medium text-slate-800">
                              Candidate:
                            </span>{" "}
                            {candidate?.name ?? "Unknown candidate"}
                          </p>

                          <p>
                            <span className="font-medium text-slate-800">
                              Email:
                            </span>{" "}
                            {candidate?.email ?? "N/A"}
                          </p>

                          <p>
                            <span className="font-medium text-slate-800">
                              Scheduled:
                            </span>{" "}
                            {new Date(interview.scheduledAt).toLocaleString()}
                          </p>

                          <p>
                            <span className="font-medium text-slate-800">
                              Duration:
                            </span>{" "}
                            {interview.duration} minutes
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start">
                        <Link
                          href={`/interview/${interview.id}`}
                          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          View Interview
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Management */}
        <section className="mt-10">
          <h2 className="text-xl font-bold text-slate-900">
            Interview Management
          </h2>

          <div className="mt-5 grid gap-5 md:grid-cols-3">
            <div className="rounded-xl border bg-white p-6 shadow-sm">
              <h3 className="font-semibold text-slate-900">Create Interview</h3>

              <p className="mt-2 text-sm text-slate-500">
                Schedule a new human + AI interview.
              </p>

              <Link
                href="/interviewer/interviews/new"
                className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Create →
              </Link>
            </div>

            <div className="rounded-xl border bg-white p-6 shadow-sm">
              <h3 className="font-semibold text-slate-900">
                Candidate Management
              </h3>

              <p className="mt-2 text-sm text-slate-500">
                Manage candidates assigned to your interviews.
              </p>
            </div>

            <div className="rounded-xl border bg-white p-6 shadow-sm">
              <h3 className="font-semibold text-slate-900">
                Interview Reports
              </h3>

              <p className="mt-2 text-sm text-slate-500">
                Review completed interview reports and evaluations.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
