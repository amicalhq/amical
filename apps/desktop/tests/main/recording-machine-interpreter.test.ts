import { describe, expect, it, vi } from "vitest";
import { RecordingMachineInterpreter } from "../../src/main/managers/recording-machine-interpreter";
import type { RecordingMachineCommand } from "../../src/main/managers/recording-state-machine";

type InterpreterDelegate = ConstructorParameters<
  typeof RecordingMachineInterpreter
>[0];

const createDelegate = (
  overrides: Partial<InterpreterDelegate> = {},
): InterpreterDelegate => ({
  getSessionId: () => null,
  emitStateChange: () => {},
  emitModeChange: () => {},
  setStopIntent: () => {},
  logInvariant: () => {},
  notifyMissingSpeechModel: () => {},
  startQuickReleaseTimer: () => {},
  clearQuickReleaseTimer: () => {},
  markFirstAudioReceived: () => {},
  notifyNoAudio: () => {},
  notifyDurationWarning: () => {},
  notifyRecordingAutoStopped: () => {},
  abortFinalization: () => {},
  startSession: async () => {},
  stopSession: async () => {},
  ...overrides,
});

describe("RecordingMachineInterpreter command execution", () => {
  it("I-48 executes commands sequentially and awaits async commands", async () => {
    const startSession = Promise.withResolvers<void>();
    const stopSession = Promise.withResolvers<void>();
    const calls: string[] = [];
    const interpreter = new RecordingMachineInterpreter(
      createDelegate({
        notifyNoAudio: () => calls.push("notifyNoAudio"),
        startSession: async () => {
          calls.push("startSession:begin");
          await startSession.promise;
          calls.push("startSession:end");
        },
        notifyDurationWarning: () => calls.push("notifyDurationWarning"),
        stopSession: async () => {
          calls.push("stopSession:begin");
          await stopSession.promise;
          calls.push("stopSession:end");
        },
        notifyRecordingAutoStopped: () =>
          calls.push("notifyRecordingAutoStopped"),
      }),
    );
    const commands: RecordingMachineCommand[] = [
      { type: "notifyNoAudio" },
      { type: "startSession", mode: "hands-free" },
      { type: "notifyDurationWarning" },
      { type: "stopSession", code: null },
      { type: "notifyRecordingAutoStopped" },
    ];

    const execution = interpreter.runCommands(commands);

    expect(calls).toEqual(["notifyNoAudio", "startSession:begin"]);

    startSession.resolve();
    await vi.waitFor(() => {
      expect(calls).toEqual([
        "notifyNoAudio",
        "startSession:begin",
        "startSession:end",
        "notifyDurationWarning",
        "stopSession:begin",
      ]);
    });

    stopSession.resolve();
    await execution;

    expect(calls).toEqual([
      "notifyNoAudio",
      "startSession:begin",
      "startSession:end",
      "notifyDurationWarning",
      "stopSession:begin",
      "stopSession:end",
      "notifyRecordingAutoStopped",
    ]);
  });
});
