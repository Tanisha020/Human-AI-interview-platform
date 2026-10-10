import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

export const instant = false;

type PageProps = { params: Promise<{ roomId: string }> };

const DIMENSIONS = [
  ["technicalKnowledge", "Technical knowledge"],
  ["problemSolving", "Problem solving"],
  ["communication", "Communication"],
  ["relevance", "Answer relevance"],
  ["confidence", "Confidence"],
  ["jobSkills", "Job skills"],
  ["behavioral", "Behavioral"],
] as const;

type DimensionKey = (typeof DIMENSIONS)[number][0];

function scoreLabel(score: number | null) {
  if (score === null || !Number.isFinite(score)) return "Not scored";
  if (score >= 8.5) return "Excellent";
  if (score >= 7) return "Good";
  if (score >= 5.5) return "Developing";
  if (score >= 4) return "Needs practice";
  return "More evidence needed";
}

function scoreColor(score: number) {
  if (score >= 7) return "text-emerald-300";
  if (score >= 5) return "text-amber-300";
  return "text-rose-300";
}

function sectionForQuestion(question: string, type: string) {
  if (type === "BEHAVIORAL") return "Communication & behavioral";
  const q = question.toLowerCase();
  if (/array|string|graph|tree|heap|stack|queue|algorithm|complexity|sliding window|dynamic programming|linked list|hashmap|hash map|hashing|collision|sorting|searching|dsa/.test(q)) return "DSA & problem solving";
  if (/database|dbms|sql|index|transaction|normalization|join|acid|query/.test(q)) return "DBMS & SQL";
  if (/operating system|process|thread|deadlock|synchroni[sz]ation|memory management|network|http|tcp|ip address|dns/.test(q)) return "OS & computer networks";
  if (/project|debug|architecture|system design|api|frontend|backend|react|deployment/.test(q)) return "Projects & engineering";
  if (/oops|object.oriented|encapsulation|inheritance|polymorphism|abstraction|singleton|java|constructor|class|interface/.test(q)) return "Programming & OOP";
  return "Core technical concepts";
}

function safeLines(value: string | null | undefined) {
  return (value || "").split("\n").map((item) => item.trim()).filter(Boolean);
}

export default async function InterviewReportPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { roomId } = await params;
  const report = await prisma.interviewReport.findUnique({
    where: { interviewId: roomId },
    include: {
      candidate: { select: { id: true, name: true } },
      interview: {
        include: {
          createdBy: { select: { name: true } },
          questions: {
            orderBy: { orderIndex: "asc" },
            include: {
              answers: {
                orderBy: { createdAt: "asc" },
                include: {
                  evaluations: {
                    where: { source: "AI" },
                    orderBy: { createdAt: "desc" },
                  },
                },
              },
            },
          },
          evaluations: {
            where: { source: "AI" },
            include: { answer: { include: { question: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!report) notFound();
  const isCandidate = report.candidateId === session.user.id;
  const isCreator = report.interview.createdById === session.user.id;
  if (!isCandidate && !isCreator && session.user.role !== "ADMIN") redirect("/dashboard");

  const answers = report.interview.questions.flatMap((question) =>
    question.answers.map((answer) => {
      const evaluation = answer.evaluations[0] ?? null;
      return { question, answer, evaluation, section: sectionForQuestion(question.question, question.type) };
    }),
  );
  const evaluatedAnswers = answers.filter((item) => item.evaluation);
  const sectionNames = [...new Set(answers.map((item) => item.section))];
  const sections = sectionNames.map((name) => {
    const items = evaluatedAnswers.filter((item) => item.section === name && item.evaluation);
    const scores = items.flatMap((item) => {
      const e = item.evaluation!;
      const values = [e.technicalKnowledge, e.problemSolving, e.communication, e.relevance, e.confidence, e.jobSkills];
      if (item.question.type === "BEHAVIORAL") values.push(e.behavioral);
      return values;
    });
    const score = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
    return { name, score, evaluated: items.length, total: answers.filter((item) => item.section === name).length };
  });
  const dimensionScores = DIMENSIONS.map(([key, label]) => {
    const applicable = evaluatedAnswers.filter((item) => key !== "behavioral" || item.question.type === "BEHAVIORAL");
    const values = applicable.map((item) => item.evaluation![key as DimensionKey]);
    const score = values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
    return { key, label, score };
  });
  const strengths = [...new Set(evaluatedAnswers.flatMap((item) => safeLines(item.evaluation?.strengths)))].slice(0, 8);
  const improvements = [...new Set(evaluatedAnswers.flatMap((item) => safeLines(item.evaluation?.weaknesses)))].slice(0, 8);
  const overall = report.overallScore;
  const overallText = overall === null ? "Awaiting enough evaluation data" : scoreLabel(overall);
  const questionCount = report.interview.questions.length;
  const answerCount = answers.length;
  const evaluationCount = evaluatedAnswers.length;

  return (
    <main className="min-h-screen bg-[#05080d] text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">IntervueAI · Interview report</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{report.interview.title}</h1>
            <p className="mt-2 text-sm text-slate-400">{report.interview.jobTitle} · Candidate: {report.candidate.name}</p>
          </div>
          <Link href={isCandidate ? "/dashboard#reports" : "/interviewer"} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/5">
            ← Back
          </Link>
        </header>

        <section className="mt-8 rounded-2xl border border-white/10 bg-[#0b111b] p-5 sm:p-7">
          <h2 className="text-lg font-semibold">Overview</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs text-slate-400">Overall score</p>
              <p className={`mt-2 text-3xl font-bold ${overall === null ? "text-slate-300" : scoreColor(overall)}`}>{overall === null ? "—" : overall.toFixed(1)}<span className="text-base font-medium text-slate-500">/10</span></p>
              <p className="mt-1 text-xs text-slate-400">{overallText}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs text-slate-400">Questions asked</p>
              <p className="mt-2 text-3xl font-bold">{questionCount}</p>
              <p className="mt-1 text-xs text-slate-400">Includes follow-up questions</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs text-slate-400">Answers submitted</p>
              <p className="mt-2 text-3xl font-bold">{answerCount}</p>
              <p className="mt-1 text-xs text-slate-400">{evaluationCount} received AI evaluation</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs text-slate-400">Interview format</p>
              <p className="mt-2 text-xl font-semibold">{report.interview.difficulty.toLowerCase()}</p>
              <p className="mt-1 text-xs text-slate-400">Planned duration: {report.interview.duration} min</p>
            </div>
          </div>
          <div className="mt-5 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4">
            <p className="text-sm font-semibold text-cyan-200">{report.recommendation || overallText}</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-300">{report.summary || "This report summarizes the answer evaluations saved during the interview."}</p>
            {evaluationCount < answerCount && <p className="mt-2 text-xs text-amber-200">Coverage note: {answerCount - evaluationCount} submitted answer(s) did not receive an AI evaluation, so they are not treated as low-scoring answers.</p>}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-bold">Section-wise rating</h2>
          <p className="mt-1 text-sm text-slate-400">Scores are based on recorded evaluations for each topic. Unscored answers are not counted as zero.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((section) => (
              <div key={section.name} className="rounded-xl border border-white/10 bg-[#0b111b] p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">{section.name}</p>
                  <p className={`shrink-0 text-sm font-bold ${section.score === null ? "text-slate-400" : scoreColor(section.score)}`}>{section.score === null ? "N/A" : section.score.toFixed(1) + "/10"}</p>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-cyan-400" style={{ width: `${section.score === null ? 0 : section.score * 10}%` }} />
                </div>
                <p className="mt-2 text-xs text-slate-500">{section.evaluated} of {section.total} answers evaluated</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-white/10 bg-[#0b111b] p-5 sm:p-7">
          <h2 className="text-xl font-bold">Detailed feedback on evaluation parameters</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dimensionScores.map((dimension) => (
              <div key={dimension.key} className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-200">{dimension.label}</p>
                  <span className={`text-sm font-bold ${dimension.score === null ? "text-slate-500" : scoreColor(dimension.score)}`}>{dimension.score === null ? "N/A" : dimension.score.toFixed(1) + "/10"}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-cyan-400" style={{ width: `${dimension.score === null ? 0 : dimension.score * 10}%` }} />
                </div>
                {dimension.key === "behavioral" && <p className="mt-2 text-xs text-slate-500">Only behavioral questions contribute to this score.</p>}
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] p-4">
              <h3 className="font-semibold text-emerald-200">Key competencies</h3>
              {strengths.length ? <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300">{strengths.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p className="mt-3 text-sm text-slate-400">No specific strengths were recorded in the available evaluations.</p>}
            </div>
            <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.04] p-4">
              <h3 className="font-semibold text-amber-200">Areas to improve</h3>
              {improvements.length ? <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300">{improvements.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p className="mt-3 text-sm text-slate-400">No specific improvement areas were recorded.</p>}
            </div>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-bold">Answer-by-answer review</h2>
          <p className="mt-1 text-sm text-slate-400">Feedback stays tied to the actual question and submitted answer, rather than merging unrelated comments into one long paragraph.</p>
          <div className="mt-4 space-y-4">
            {answers.map(({ question, answer, evaluation }, index) => (
              <article key={answer.id} className="rounded-2xl border border-white/10 bg-[#0b111b] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Question {index + 1} · {question.type.toLowerCase().replaceAll("_", " ")}</p>
                  <span className={`rounded-full border border-white/10 px-3 py-1 text-xs font-semibold ${evaluation ? scoreColor((evaluation.technicalKnowledge + evaluation.problemSolving + evaluation.communication + evaluation.relevance + evaluation.confidence + evaluation.jobSkills) / 6) : "text-slate-400"}`}>{evaluation ? "Evaluated" : "Not evaluated"}</span>
                </div>
                <h3 className="mt-3 font-semibold leading-6">{question.question}</h3>
                <div className="mt-4 rounded-xl bg-black/25 p-4">
                  <p className="text-xs font-semibold text-slate-400">Candidate answer</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{answer.answerText}</p>
                </div>
                {evaluation ? (
                  <>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {DIMENSIONS.filter(([key]) => key !== "behavioral" || question.type === "BEHAVIORAL").map(([key, label]) => (
                        <div key={key} className="rounded-lg border border-white/10 p-3">
                          <p className="text-xs text-slate-400">{label}</p>
                          <p className={`mt-1 font-semibold ${scoreColor(evaluation[key as DimensionKey])}`}>{evaluation[key as DimensionKey]}/10</p>
                        </div>
                      ))}
                    </div>
                    {evaluation.feedback && <p className="mt-4 text-sm leading-6 text-slate-300"><span className="font-semibold text-cyan-200">Feedback: </span>{evaluation.feedback}</p>}
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      {safeLines(evaluation.strengths).length > 0 && <div><p className="text-xs font-semibold text-emerald-200">What went well</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">{safeLines(evaluation.strengths).map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
                      {safeLines(evaluation.weaknesses).length > 0 && <div><p className="text-xs font-semibold text-amber-200">Next improvement</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">{safeLines(evaluation.weaknesses).map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
                    </div>
                  </>
                ) : (
                  <p className="mt-4 text-sm text-slate-400">No AI evaluation was saved for this answer. It is not counted as a zero.</p>
                )}
              </article>
            ))}
            {answers.length === 0 && <div className="rounded-xl border border-white/10 bg-[#0b111b] p-6 text-sm text-slate-400">No submitted answers were saved for this interview.</div>}
          </div>
        </section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5 text-xs text-slate-500">
          <p>Generated from the evaluations saved by IntervueAI. Scores are practice feedback, not a hiring decision.</p>
          <Link href={isCandidate ? "/dashboard#reports" : "/interviewer"} className="font-medium text-cyan-200 hover:text-cyan-100">Back to dashboard ↑</Link>
        </footer>
      </div>
    </main>
  );
}
