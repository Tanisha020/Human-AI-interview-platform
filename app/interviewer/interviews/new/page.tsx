"use client";

import Link from "next/link";
import { useState } from "react";

export default function CreateInterviewPage() {
  const [title, setTitle] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [difficulty, setDifficulty] = useState("MEDIUM");
  const [duration, setDuration] = useState("45");
  const [scheduledAt, setScheduledAt] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const scheduledDate = new Date(scheduledAt);
    if (!scheduledAt || !Number.isFinite(scheduledDate.getTime())) {
      alert("Please select a valid interview date and time.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/interviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          jobTitle,
          jobDescription,
          difficulty,
          duration: Number(duration),
          // Convert the browser-local datetime to UTC so the server stores
          // the intended instant consistently across deployment time zones.
          scheduledAt: new Date(scheduledAt).toISOString(),
          candidateEmail,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error ?? "Failed to create interview.");
        return;
      }

      alert("Interview created successfully!");

      window.location.href = "/interviewer";
    } catch (error) {
      console.error("Create interview error:", error);
      alert("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8">
          <Link
            href="/interviewer"
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            ← Back to Interviewer Dashboard
          </Link>

          <h1 className="mt-5 text-3xl font-bold text-slate-900">
            Create Interview
          </h1>

          <p className="mt-2 text-slate-600">
            Create and schedule a new interview session.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border bg-white p-6 shadow-sm"
        >
          <div className="space-y-6">
            <div>
              <label
                htmlFor="title"
                className="mb-2 block text-sm font-medium text-slate-900"
              >
                Interview Title
              </label>

              <input
                id="title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Software Engineer Technical Interview"
                required
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label
                htmlFor="jobTitle"
                className="mb-2 block text-sm font-medium text-slate-900"
              >
                Job Title
              </label>

              <input
                id="jobTitle"
                type="text"
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
                placeholder="e.g. Software Development Engineer"
                required
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label
                htmlFor="jobDescription"
                className="mb-2 block text-sm font-medium text-slate-900"
              >
                Job Description
              </label>

              <textarea
                id="jobDescription"
                value={jobDescription}
                onChange={(event) =>
                  setJobDescription(event.target.value)
                }
                placeholder="Describe the role, responsibilities and required skills..."
                rows={6}
                required
                className="w-full resize-none rounded-lg border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <label
                  htmlFor="difficulty"
                  className="mb-2 block text-sm font-medium text-slate-900"
                >
                  Difficulty
                </label>

                <select
                  id="difficulty"
                  value={difficulty}
                  onChange={(event) =>
                    setDifficulty(event.target.value)
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="EASY">Easy</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HARD">Hard</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="duration"
                  className="mb-2 block text-sm font-medium text-slate-900"
                >
                  Duration (minutes)
                </label>

                <input
                  id="duration"
                  type="number"
                  min="15"
                  max="180"
                  value={duration}
                  onChange={(event) =>
                    setDuration(event.target.value)
                  }
                  required
                  className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="scheduledAt"
                className="mb-2 block text-sm font-medium text-slate-900"
              >
                Scheduled Date & Time
              </label>

              <input
                id="scheduledAt"
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) =>
                  setScheduledAt(event.target.value)
                }
                required
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />

              <p className="mt-2 text-xs text-slate-500">
                Selected value: {scheduledAt || "None"}
              </p>
            </div>

            <div>
              <label
                htmlFor="candidateEmail"
                className="mb-2 block text-sm font-medium text-slate-900"
              >
                Candidate Email
              </label>

              <input
                id="candidateEmail"
                type="email"
                value={candidateEmail}
                onChange={(event) =>
                  setCandidateEmail(event.target.value)
                }
                placeholder="candidate@example.com"
                required
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          <div className="mt-8 flex items-center justify-end gap-3 border-t pt-6">
            <Link
              href="/interviewer"
              className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>

            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Interview"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}