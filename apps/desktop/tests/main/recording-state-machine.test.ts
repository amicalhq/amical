import { describe, expect, it } from "vitest";
import {
  initialRecordingMachineState,
  transitionRecordingMachine,
  type RecordingMachineCommand,
  type RecordingMachineEvent,
  type RecordingMachineState,
} from "../../src/main/managers/recording-state-machine";

const step = (
  state: RecordingMachineState,
  event: RecordingMachineEvent,
): [RecordingMachineState, RecordingMachineCommand[]] => {
  const result = transitionRecordingMachine(state, event);
  return [result.state, result.commands];
};

const start = (mode: "ptt" | "hands-free"): RecordingMachineState =>
  transitionRecordingMachine(initialRecordingMachineState(), {
    type: "start",
    mode,
    hasSpeechModel: true,
  }).state;

const ready = (state: RecordingMachineState): RecordingMachineState =>
  transitionRecordingMachine(state, { type: "startSessionReady" }).state;

const startPtt = (): RecordingMachineState => ready(start("ptt"));

const startHandsFree = (): RecordingMachineState => ready(start("hands-free"));

const activeStates = (): RecordingMachineState[] => [
  { tag: "REC_PTT", firstChunkReceived: false },
  { tag: "PTT_Q", firstChunkReceived: false },
  { tag: "REC_HF", firstChunkReceived: false },
];

describe("recording state machine", () => {
  it("starts PTT only when a speech model is selected", () => {
    const [missingModelState, missingModelCommands] = step(
      initialRecordingMachineState(),
      { type: "start", mode: "ptt", hasSpeechModel: false },
    );

    expect(missingModelState).toEqual({ tag: "IDLE" });
    expect(missingModelCommands).toEqual([{ type: "notifyMissingModel" }]);

    const [state, commands] = step(initialRecordingMachineState(), {
      type: "start",
      mode: "ptt",
      hasSpeechModel: true,
    });

    expect(state).toEqual({ tag: "STARTING", mode: "ptt" });
    expect(commands).toEqual([{ type: "startSession", mode: "ptt" }]);
  });

  it("starts hands-free when requested", () => {
    const [state, commands] = step(initialRecordingMachineState(), {
      type: "start",
      mode: "hands-free",
      hasSpeechModel: true,
    });

    expect(state).toEqual({ tag: "STARTING", mode: "hands-free" });
    expect(commands).toEqual([{ type: "startSession", mode: "hands-free" }]);
  });

  it("moves from STARTING into the requested recording mode", () => {
    const [pttState, pttCommands] = step(start("ptt"), {
      type: "startSessionReady",
    });
    expect(pttState).toEqual({
      tag: "REC_PTT",
      firstChunkReceived: false,
    });
    expect(pttCommands).toEqual([]);

    const [handsFreeState, handsFreeCommands] = step(start("hands-free"), {
      type: "startSessionReady",
    });
    expect(handsFreeState).toEqual({
      tag: "REC_HF",
      firstChunkReceived: false,
    });
    expect(handsFreeCommands).toEqual([]);
  });

  it("honors signalStop while STARTING", () => {
    const [state, commands] = step(start("hands-free"), {
      type: "signalStop",
    });

    expect(state).toEqual({ tag: "STOP_C", code: "interrupted_start" });
    expect(commands).toEqual([
      { type: "stopSession", code: "interrupted_start" },
    ]);
  });

  it("logs and ignores start while already active", () => {
    const recording = startPtt();
    const [state, commands] = step(recording, {
      type: "start",
      mode: "hands-free",
      hasSpeechModel: true,
    });

    expect(state).toEqual(recording);
    expect(commands).toEqual([
      { type: "logUnexpectedStart", mode: "hands-free" },
    ]);
  });

  it("turns a quick PTT release into a double-tap hands-free session", () => {
    const [quickState, quickCommands] = step(startPtt(), {
      type: "pttRelease",
      quick: true,
    });

    expect(quickState).toEqual({
      tag: "PTT_Q",
      firstChunkReceived: false,
    });
    expect(quickCommands).toEqual([{ type: "startQuickReleaseTimer" }]);

    const [handsFreeState, handsFreeCommands] = step(quickState, {
      type: "pttPress",
      quick: true,
    });

    expect(handsFreeState).toEqual({
      tag: "REC_HF",
      firstChunkReceived: false,
    });
    expect(handsFreeCommands).toEqual([{ type: "clearQuickReleaseTimer" }]);
  });

  it("cancels quick PTT release when the quick timer fires", () => {
    const [quickState] = step(startPtt(), {
      type: "pttRelease",
      quick: true,
    });
    const [state, commands] = step(quickState, {
      type: "quickReleaseTimeout",
    });

    expect(state).toEqual({ tag: "STOP_C", code: "quick_release" });
    expect(commands).toEqual([{ type: "stopSession", code: "quick_release" }]);
  });

  it.each(activeStates().map((state) => [state.tag, state] as const))(
    "allows signalStop to stop from %s",
    (_tag, activeState) => {
      const [state, commands] = step(activeState, { type: "signalStop" });

      expect(state).toEqual({ tag: "STOP_N" });
      expect(commands).toEqual(
        activeState.tag === "PTT_Q"
          ? [
              { type: "clearQuickReleaseTimer" },
              { type: "stopSession", code: null },
            ]
          : [{ type: "stopSession", code: null }],
      );
    },
  );

  it("switches toggle from PTT to hands-free", () => {
    const [state, commands] = step(startPtt(), {
      type: "toggle",
      quick: false,
    });

    expect(state).toEqual({
      tag: "REC_HF",
      firstChunkReceived: false,
    });
    expect(commands).toEqual([]);
  });

  it("switches toggle from quick-release PTT to hands-free", () => {
    const [quickState] = step(startPtt(), {
      type: "pttRelease",
      quick: true,
    });
    const [state, commands] = step(quickState, {
      type: "toggle",
      quick: true,
    });

    expect(state).toEqual({
      tag: "REC_HF",
      firstChunkReceived: false,
    });
    expect(commands).toEqual([{ type: "clearQuickReleaseTimer" }]);
  });

  it.each([
    ["quick", true, { tag: "STOP_C", code: "quick_release" }, "quick_release"],
    ["slow", false, { tag: "STOP_N" }, null],
  ] as const)(
    "stops hands-free on %s toggle",
    (_name, quick, expectedState, expectedCode) => {
      const [state, commands] = step(startHandsFree(), {
        type: "toggle",
        quick,
      });

      expect(state).toEqual(expectedState);
      expect(commands).toEqual([{ type: "stopSession", code: expectedCode }]);
    },
  );

  it.each([
    ["quick", true, { tag: "STOP_C", code: "quick_release" }, "quick_release"],
    ["slow", false, { tag: "STOP_N" }, null],
  ] as const)(
    "stops hands-free on %s PTT press",
    (_name, quick, expectedState, expectedCode) => {
      const [state, commands] = step(startHandsFree(), {
        type: "pttPress",
        quick,
      });

      expect(state).toEqual(expectedState);
      expect(commands).toEqual([{ type: "stopSession", code: expectedCode }]);
    },
  );

  it("ignores repeated PTT press while already recording in PTT", () => {
    const recording = startPtt();
    const [state, commands] = step(recording, {
      type: "pttPress",
      quick: true,
    });

    expect(state).toEqual(recording);
    expect(commands).toEqual([]);
  });

  it("tracks first audio and suppresses no-audio cancellation afterward", () => {
    const [withAudioState, firstAudioCommands] = step(startHandsFree(), {
      type: "audioChunk",
      hasAudio: true,
    });

    expect(withAudioState).toEqual({
      tag: "REC_HF",
      firstChunkReceived: true,
    });
    expect(firstAudioCommands).toEqual([{ type: "markFirstAudioReceived" }]);

    const [state, commands] = step(withAudioState, {
      type: "noAudioTimeout",
    });

    expect(state).toEqual(withAudioState);
    expect(commands).toEqual([]);
  });

  it("ignores non-audio chunks", () => {
    const recording = startHandsFree();
    const [state, commands] = step(recording, {
      type: "audioChunk",
      hasAudio: false,
    });

    expect(state).toEqual(recording);
    expect(commands).toEqual([]);
  });

  it("treats repeated audio chunks after first audio as idempotent", () => {
    const [withAudioState] = step(startHandsFree(), {
      type: "audioChunk",
      hasAudio: true,
    });
    const [state, commands] = step(withAudioState, {
      type: "audioChunk",
      hasAudio: true,
    });

    expect(state).toEqual(withAudioState);
    expect(commands).toEqual([]);
  });

  it("cancels recording when no audio arrives before the no-audio timer", () => {
    const [state, commands] = step(startHandsFree(), {
      type: "noAudioTimeout",
    });

    expect(state).toEqual({ tag: "STOP_C", code: "no_audio" });
    expect(commands).toEqual([
      { type: "notifyNoAudio" },
      { type: "stopSession", code: "no_audio" },
    ]);
  });

  it("clears quick-release timer when no-audio timeout stops PTT_Q", () => {
    const [state, commands] = step(
      { tag: "PTT_Q", firstChunkReceived: false },
      { type: "noAudioTimeout" },
    );

    expect(state).toEqual({ tag: "STOP_C", code: "no_audio" });
    expect(commands).toEqual([
      { type: "notifyNoAudio" },
      { type: "clearQuickReleaseTimer" },
      { type: "stopSession", code: "no_audio" },
    ]);
  });

  it("auto-stops at max duration and leaves warnings as same-state output", () => {
    const recording = startHandsFree();

    const [warnState, warnCommands] = step(recording, {
      type: "durationWarningTimeout",
    });
    expect(warnState).toEqual(recording);
    expect(warnCommands).toEqual([{ type: "notifyDurationWarning" }]);

    const [stopState, stopCommands] = step(recording, {
      type: "maxDurationTimeout",
    });
    expect(stopState).toEqual({ tag: "STOP_N" });
    expect(stopCommands).toEqual([
      { type: "notifyRecordingAutoStopped" },
      { type: "stopSession", code: null },
    ]);
  });

  it.each([
    ["PTT_Q", { tag: "PTT_Q", firstChunkReceived: false }],
    ["STOP_N", { tag: "STOP_N" }],
    ["STOP_C", { tag: "STOP_C", code: "quick_release" }],
  ] as const)(
    "handles max duration timeout from %s",
    (_name, stateBeforeTimeout) => {
      const [state, commands] = step(stateBeforeTimeout, {
        type: "maxDurationTimeout",
      });

      if (stateBeforeTimeout.tag === "PTT_Q") {
        expect(state).toEqual({ tag: "STOP_N" });
        expect(commands).toEqual([
          { type: "notifyRecordingAutoStopped" },
          { type: "clearQuickReleaseTimer" },
          { type: "stopSession", code: null },
        ]);
        return;
      }

      expect(state).toEqual(stateBeforeTimeout);
      expect(commands).toEqual([]);
    },
  );

  it.each([
    ["IDLE", { tag: "IDLE" }],
    ["STOP_N", { tag: "STOP_N" }],
    ["STOP_C", { tag: "STOP_C", code: "no_audio" }],
  ] as const)("resets from %s", (_name, stateBeforeReset) => {
    const [state, commands] = step(stateBeforeReset, { type: "reset" });

    expect(state).toEqual({ tag: "IDLE" });
    expect(commands).toEqual([]);
  });

  it.each([
    ["STARTING", { tag: "STARTING", mode: "ptt" }],
    ["REC_PTT", { tag: "REC_PTT", firstChunkReceived: false }],
    ["PTT_Q", { tag: "PTT_Q", firstChunkReceived: true }],
    ["REC_HF", { tag: "REC_HF", firstChunkReceived: false }],
  ] as const)(
    "ignores normal reset from active state %s",
    (_name, activeState) => {
      const [state, commands] = step(activeState, { type: "reset" });

      expect(state).toEqual(activeState);
      expect(commands).toEqual([]);
    },
  );

  it.each([
    ["STARTING", { tag: "STARTING", mode: "ptt" }],
    ["REC_PTT", { tag: "REC_PTT", firstChunkReceived: false }],
    ["PTT_Q", { tag: "PTT_Q", firstChunkReceived: true }],
    ["REC_HF", { tag: "REC_HF", firstChunkReceived: false }],
    ["STOP_N", { tag: "STOP_N" }],
  ] as const)("force-resets from %s", (_name, stateBeforeReset) => {
    const [state, commands] = step(stateBeforeReset, { type: "forceReset" });

    expect(state).toEqual({ tag: "IDLE" });
    expect(commands).toEqual([]);
  });

  it.each([
    ["STOP_N", { tag: "STOP_N" }],
    ["STOP_C", { tag: "STOP_C", code: "quick_release" }],
  ] as const)("ignores audio chunks from %s", (_name, stoppingState) => {
    const [state, commands] = step(stoppingState, {
      type: "audioChunk",
      hasAudio: true,
    });

    expect(state).toEqual(stoppingState);
    expect(commands).toEqual([]);
  });

  it("ignores audio chunks while STARTING", () => {
    const startingState: RecordingMachineState = {
      tag: "STARTING",
      mode: "hands-free",
    };
    const [state, commands] = step(startingState, {
      type: "audioChunk",
      hasAudio: true,
    });

    expect(state).toEqual(startingState);
    expect(commands).toEqual([]);
  });

  it("returns a transition for every state and event pairing", () => {
    const states: RecordingMachineState[] = [
      { tag: "IDLE" },
      { tag: "STARTING", mode: "ptt" },
      { tag: "STARTING", mode: "hands-free" },
      { tag: "REC_PTT", firstChunkReceived: false },
      { tag: "REC_PTT", firstChunkReceived: true },
      { tag: "PTT_Q", firstChunkReceived: false },
      { tag: "PTT_Q", firstChunkReceived: true },
      { tag: "REC_HF", firstChunkReceived: false },
      { tag: "REC_HF", firstChunkReceived: true },
      { tag: "STOP_N" },
      { tag: "STOP_C", code: "quick_release" },
      { tag: "STOP_C", code: "no_audio" },
      { tag: "STOP_C", code: "interrupted_start" },
    ];
    const events: RecordingMachineEvent[] = [
      { type: "start", mode: "ptt", hasSpeechModel: true },
      { type: "start", mode: "hands-free", hasSpeechModel: false },
      { type: "startSessionReady" },
      { type: "pttPress", quick: true },
      { type: "pttRelease", quick: true },
      { type: "toggle", quick: true },
      { type: "signalStop" },
      { type: "quickReleaseTimeout" },
      { type: "noAudioTimeout" },
      { type: "durationWarningTimeout" },
      { type: "maxDurationTimeout" },
      { type: "audioChunk", hasAudio: true },
      { type: "audioChunk", hasAudio: false },
      { type: "reset" },
      { type: "forceReset" },
    ];

    for (const state of states) {
      for (const event of events) {
        const result = transitionRecordingMachine(state, event);

        expect(result).toHaveProperty("state");
        expect(Array.isArray(result.commands)).toBe(true);
      }
    }
  });

  describe("dismiss event", () => {
    it("dismisses an active PTT recording to STOP_C(user_dismissed)", () => {
      const [state, commands] = step(
        { tag: "REC_PTT", firstChunkReceived: true },
        { type: "dismiss" },
      );
      expect(state).toEqual({ tag: "STOP_C", code: "user_dismissed" });
      expect(commands).toContainEqual({
        type: "stopSession",
        code: "user_dismissed",
      });
    });

    it("dismisses an active hands-free recording to STOP_C(user_dismissed)", () => {
      const [state, commands] = step(
        { tag: "REC_HF", firstChunkReceived: true },
        { type: "dismiss" },
      );
      expect(state).toEqual({ tag: "STOP_C", code: "user_dismissed" });
      expect(commands).toContainEqual({
        type: "stopSession",
        code: "user_dismissed",
      });
    });

    it("dismisses a PTT quick-release window to STOP_C(user_dismissed) and clears its timer", () => {
      const [state, commands] = step(
        { tag: "PTT_Q", firstChunkReceived: true },
        { type: "dismiss" },
      );
      expect(state).toEqual({ tag: "STOP_C", code: "user_dismissed" });
      expect(commands).toContainEqual({ type: "clearQuickReleaseTimer" });
      expect(commands).toContainEqual({
        type: "stopSession",
        code: "user_dismissed",
      });
    });

    it("routes a dismiss during STARTING to interrupted_start (discard, no audio yet)", () => {
      const [state, commands] = step(
        { tag: "STARTING", mode: "hands-free" },
        { type: "dismiss" },
      );
      expect(state).toEqual({ tag: "STOP_C", code: "interrupted_start" });
      expect(commands).toContainEqual({
        type: "stopSession",
        code: "interrupted_start",
      });
    });

    it("dismisses an in-flight finalize (STOP_N) to STOP_C(user_dismissed) via abortFinalization", () => {
      const [state, commands] = step({ tag: "STOP_N" }, { type: "dismiss" });
      expect(state).toEqual({ tag: "STOP_C", code: "user_dismissed" });
      expect(commands).toEqual([{ type: "abortFinalization" }]);
    });

    it("ignores dismiss when idle or already cancelling", () => {
      for (const idle of [
        { tag: "IDLE" } as const,
        { tag: "STOP_C", code: "no_audio" } as const,
      ]) {
        const [state, commands] = step(idle, { type: "dismiss" });
        expect(state).toBe(idle);
        expect(commands).toEqual([]);
      }
    });
  });
});
