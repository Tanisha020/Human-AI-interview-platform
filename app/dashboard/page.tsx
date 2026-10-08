import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";

export const instant = false;

export default async function CandidateDashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role === "INTERVIEWER") {
    redirect("/interviewer");
  }

  if (session.user.role === "ADMIN") {
    redirect("/admin");
  }

  const interviews = await prisma.interview.findMany({
    where: {
      participants: {
        some: {
          userId: session.user.id,
          role: "CANDIDATE",
        },
      },
    },
    orderBy: {
      scheduledAt: "asc",
    },
  });

  const upcomingInterviews = interviews.filter(
    (interview) => interview.status === "SCHEDULED"
  );

  const completedInterviews = interviews.filter(
    (interview) => interview.status === "COMPLETED"
  );

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* Header */}
        <div>
          <p className="text-sm font-medium text-blue-600">
            Candidate Portal
          </p>

          <h1 className="mt-1 text-3xl font-bold text-slate-900">
            Candidate Dashboard
          </h1>

          <p className="mt-2 text-slate-600">
            Welcome, {session.user.name ?? "Candidate"}.
          </p>
        </div>

        {/* Stats */}
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">
              Upcoming Interviews
            </p>

            <p className="mt-2 text-3xl font-bold text-slate-900">
              {upcomingInterviews.length}
            </p>
          </div>

          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">
              Completed Interviews
            </p>

            <p className="mt-2 text-3xl font-bold text-slate-900">
              {completedInterviews.length}
            </p>
          </div>

          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">
              Total Interviews
            </p>

            <p className="mt-2 text-3xl font-bold text-slate-900">
              {interviews.length}
            </p>
          </div>
        </div>

        {/* Upcoming Interviews */}
        <section className="mt-10">
          <h2 className="text-xl font-bold text-slate-900">
            Upcoming Interviews
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Your scheduled interviews will appear here.
          </p>

          {upcomingInterviews.length === 0 ? (
            <div className="mt-5 rounded-xl border bg-white p-8 text-center shadow-sm">
              <p className="font-medium text-slate-900">
                No upcoming interviews
              </p>

              <p className="mt-2 text-sm text-slate-500">
                You don't have any scheduled interviews yet.
              </p>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {upcomingInterviews.map((interview) => (
                <div
                  key={interview.id}
                  className="rounded-xl border bg-white p-6 shadow-sm"
                >
                  <div className="flex flex-col justify-between gap-5 md:flex-row">
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
                            Scheduled:
                          </span>{" "}
                          {new Date(
                            interview.scheduledAt
                          ).toLocaleString()}
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
                        className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
                      >
                        Join Interview
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Practice */}
        <section className="mt-10">
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">
              Practice Interviews
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              Practice with our AI interviewer and improve your interview
              skills.
            </p>

            <button
              type="button"
              className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Start Practice
            </button>
          </div>
        </section>

        {/* Reports */}
        <section className="mt-6">
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">
              Reports
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              View your interview performance reports.
            </p>

            <button
              type="button"
              className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              View Reports
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}