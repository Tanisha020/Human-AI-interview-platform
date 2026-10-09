import assert from "node:assert/strict";
import test from "node:test";

import {
  getInterviewState,
  setCurrentQuestion,
  transitionInterview,
} from "../server/interview/interview-engine";

test("reset clears the active question and Next Question reuses its number", () => {
  const roomId = "test-reset-blank";
  transitionInterview(roomId, "START_INTERVIEW");
  transitionInterview(roomId, "AI_START");
  setCurrentQuestion(roomId, "Tell me about yourself.");

  const reset = transitionInterview(roomId, "RESET_QUESTION");
  assert.equal(reset.currentQuestion, null);
  assert.equal(reset.state, "AI_LISTENING");
  assert.equal(reset.questionNumber, 2);

  const next = transitionInterview(roomId, "NEXT_QUESTION");
  assert.equal(next.state, "AI_TURN");
  assert.equal(next.currentQuestion, null);
  assert.equal(next.questionNumber, 2);
});

test("reset works while an answer is being analyzed", () => {
  const roomId = "test-reset-during-analysis";
  transitionInterview(roomId, "START_INTERVIEW");
  transitionInterview(roomId, "AI_START");
  setCurrentQuestion(roomId, "Explain OOP.");
  transitionInterview(roomId, "CANDIDATE_ANSWER");

  assert.equal(getInterviewState(roomId).state, "AI_ANALYZING");
  const reset = transitionInterview(roomId, "RESET_QUESTION");

  assert.equal(reset.state, "AI_LISTENING");
  assert.equal(reset.currentQuestion, null);
});

test("human takeover can return control to the AI", () => {
  const roomId = "test-human-takeover";
  transitionInterview(roomId, "START_INTERVIEW");
  transitionInterview(roomId, "AI_START");
  setCurrentQuestion(roomId, "Explain a hash map.");

  const takeover = transitionInterview(roomId, "HUMAN_TAKEOVER");
  assert.equal(takeover.state, "HUMAN_TURN");
  assert.equal(takeover.aiPausedByHuman, true);

  const resumed = transitionInterview(roomId, "HUMAN_FINISHED");
  assert.equal(resumed.state, "AI_LISTENING");
  assert.equal(resumed.aiPausedByHuman, false);
});

test("completed interviews cannot be restarted or changed", () => {
  const roomId = "test-completed-terminal";
  transitionInterview(roomId, "START_INTERVIEW");
  transitionInterview(roomId, "END_INTERVIEW");

  const afterStart = transitionInterview(roomId, "START_INTERVIEW");
  assert.equal(afterStart.state, "COMPLETED");

  const afterReset = transitionInterview(roomId, "RESET_QUESTION");
  assert.equal(afterReset.state, "COMPLETED");
});
