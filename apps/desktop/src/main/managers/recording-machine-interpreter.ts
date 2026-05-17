import { logger } from "../logger";
import type { RecordingState } from "../../types/recording";
import {
  initialRecordingMachineState,
  transitionRecordingMachine,
  type ActiveRecordingMode,
  type RecordingMachineCommand,
  type RecordingMachineEvent,
  type RecordingMachineState,
  type RecordingMode,
  type TerminationCode,
} from "./recording-state-machine";

type AsyncRecordingMachineCommand = Extract<
  RecordingMachineCommand,
  { type: "startSession" } | { type: "stopSession" }
>;
type SyncRecordingMachineCommand = Exclude<
  RecordingMachineCommand,
  AsyncRecordingMachineCommand
>;
type StopRecordingMachineCommand = Extract<
  RecordingMachineCommand,
  { type: "stopSession" }
>;
export type StoppingRecordingMachineState = Extract<
  RecordingMachineState,
  { tag: "STOP_N" | "STOP_C" }
>;
export type PendingStopWaitResult = "none" | "resolved" | "timeout";
export type PendingStopSession = {
  promise: Promise<void>;
  resolve: () => void;
};

type RecordingMachineInterpreterDelegate = {
  getSessionId(): string | null;
  emitStateChange(newState: RecordingState, oldState: RecordingState): void;
  emitModeChange(newMode: RecordingMode, oldMode: RecordingMode): void;
  setStopIntent(code: TerminationCode | null, stoppedAt: number): void;
  logInvariant(message: string, metadata: Record<string, unknown>): void;
  notifyMissingSpeechModel(): void;
  startQuickReleaseTimer(): void;
  clearQuickReleaseTimer(): void;
  markFirstAudioReceived(): void;
  notifyNoAudio(): void;
  notifyDurationWarning(): void;
  notifyRecordingAutoStopped(): void;
  startSession(mode: ActiveRecordingMode): Promise<void>;
  stopSession(code: TerminationCode | null): Promise<void>;
};

// Shared by the pending-stop wait and stuck-state recovery timer. If both
// recovery paths fire together, RecordingManager.forceIdle() dedupes them.
export const RECORDING_STOP_RECOVERY_TIMEOUT = 10000;

const isAsyncRecordingMachineCommand = (
  command: RecordingMachineCommand,
): command is AsyncRecordingMachineCommand =>
  command.type === "startSession" || command.type === "stopSession";

const isStopRecordingMachineCommand = (
  command: RecordingMachineCommand,
): command is StopRecordingMachineCommand => command.type === "stopSession";

export class RecordingMachineInterpreter {
  private machineState: RecordingMachineState = initialRecordingMachineState();
  private pendingStopSession: PendingStopSession | null = null;

  constructor(private delegate: RecordingMachineInterpreterDelegate) {}

  get currentState(): RecordingMachineState {
    return this.machineState;
  }

  /** @internal Test helper for seeding the interpreter without mutating private fields. */
  __setStateForTesting(state: RecordingMachineState): void {
    this.machineState = state;
  }

  get currentPendingStopSession(): PendingStopSession | null {
    return this.pendingStopSession;
  }

  getPublicState(): RecordingState {
    return this.recordingStateForMachine(this.machineState);
  }

  getPublicMode(): RecordingMode {
    return this.recordingModeForMachine(this.machineState);
  }

  isStoppingState(
    state: RecordingMachineState,
  ): state is StoppingRecordingMachineState {
    return state.tag === "STOP_N" || state.tag === "STOP_C";
  }

  effectiveStopCodeForState(
    stopState: StoppingRecordingMachineState,
    commandCode: TerminationCode | null,
  ): TerminationCode | null {
    if (stopState.tag === "STOP_N") {
      if (commandCode !== null) {
        this.delegate.logInvariant("Recording stop code mismatch", {
          commandCode,
          stopState: this.describeState(stopState),
        });
      }

      return null;
    }

    if (commandCode !== stopState.code) {
      this.delegate.logInvariant("Recording stop code mismatch", {
        commandCode,
        stopState: this.describeState(stopState),
      });
    }

    return stopState.code;
  }

  shouldFinalizeWithoutFinalChunk(
    stopState: StoppingRecordingMachineState,
  ): boolean {
    return stopState.tag === "STOP_C" && stopState.code === "interrupted_start";
  }

  shouldTransitionOnAudioChunk(hasAudio: boolean): boolean {
    const state = this.machineState;
    return (
      hasAudio &&
      (state.tag === "REC_PTT" ||
        state.tag === "PTT_Q" ||
        state.tag === "REC_HF") &&
      !state.firstChunkReceived
    );
  }

  describeCurrentState(): string {
    return this.describeState(this.machineState);
  }

  describeState(state: RecordingMachineState): string {
    if (state.tag === "STARTING") {
      return `${state.tag}:${state.mode}`;
    }

    if (state.tag === "STOP_C") {
      return `${state.tag}:${state.code}`;
    }

    if (
      state.tag === "REC_PTT" ||
      state.tag === "PTT_Q" ||
      state.tag === "REC_HF"
    ) {
      return `${state.tag}:${state.firstChunkReceived ? "has_audio" : "no_audio_yet"}`;
    }

    return state.tag;
  }

  transition(event: RecordingMachineEvent): RecordingMachineCommand[] {
    const previousState = this.machineState;
    const next = transitionRecordingMachine(this.machineState, event);
    this.machineState = next.state;
    this.prepareStopSessionIntent(next.state, next.commands);

    if (previousState.tag !== next.state.tag || next.commands.length > 0) {
      logger.audio.info("Recording FSM transition", {
        event,
        previousState: this.describeState(previousState),
        nextState: this.describeState(next.state),
        commands: next.commands.map((command) => command.type),
        sessionId: this.delegate.getSessionId(),
      });
    }

    this.emitPublicStateChanges(previousState, next.state);

    return next.commands;
  }

  async handleEvent(event: RecordingMachineEvent): Promise<void> {
    await this.runCommands(this.transition(event));
  }

  handleSyncEvent(event: RecordingMachineEvent): SyncRecordingMachineCommand[] {
    const commands = this.transition(event);
    const syncCommands: SyncRecordingMachineCommand[] = [];

    for (const command of commands) {
      if (isAsyncRecordingMachineCommand(command)) {
        this.delegate.logInvariant(
          "Cannot run async recording FSM command synchronously",
          {
            command,
            machineState: this.describeCurrentState(),
          },
        );
        continue;
      }

      syncCommands.push(command);
    }

    return syncCommands;
  }

  async runCommands(commands: RecordingMachineCommand[]): Promise<void> {
    for (const command of commands) {
      if (!isAsyncRecordingMachineCommand(command)) {
        this.runSyncCommand(command);
        continue;
      }

      switch (command.type) {
        case "startSession":
          await this.delegate.startSession(command.mode);
          break;
        case "stopSession":
          await this.delegate.stopSession(command.code);
          break;
      }
    }
  }

  runSyncCommands(commands: SyncRecordingMachineCommand[]): void {
    for (const command of commands) {
      this.runSyncCommand(command);
    }
  }

  resolvePendingStopSession(
    pendingStopSession = this.pendingStopSession,
  ): void {
    if (!pendingStopSession) {
      return;
    }

    pendingStopSession.resolve();

    if (this.pendingStopSession === pendingStopSession) {
      this.pendingStopSession = null;
    }
  }

  async waitForPendingStopSession(
    timeoutMs = RECORDING_STOP_RECOVERY_TIMEOUT,
  ): Promise<PendingStopWaitResult> {
    const pendingStopSession = this.pendingStopSession;
    if (!pendingStopSession) {
      return "none";
    }

    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve("timeout");
      }, timeoutMs);
    });

    const result = await Promise.race([
      pendingStopSession.promise.then(() => "resolved" as const),
      timeoutPromise,
    ]);

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    if (
      result === "timeout" &&
      this.pendingStopSession !== pendingStopSession
    ) {
      return "resolved";
    }

    if (result === "timeout") {
      this.delegate.logInvariant(
        "Timed out waiting for recording stop command",
        {
          timeoutMs,
          machineState: this.describeCurrentState(),
          recordingState: this.getPublicState(),
        },
      );
      return "timeout";
    }

    return result;
  }

  resetSession(options: { force?: boolean } = {}): boolean {
    if (!options.force && this.getPublicState() === "recording") {
      this.delegate.logInvariant(
        "Refusing normal session reset from active recording state",
        { machineState: this.describeCurrentState() },
      );
      return false;
    }

    this.transition({
      type: options.force ? "forceReset" : "reset",
    });
    this.resolvePendingStopSession();
    return true;
  }

  private runSyncCommand(command: SyncRecordingMachineCommand): void {
    switch (command.type) {
      case "logUnexpectedStart":
        logger.audio.warn("Cannot start recording - FSM is not idle", {
          requestedMode: command.mode,
          machineState: this.describeCurrentState(),
          recordingState: this.getPublicState(),
          recordingMode: this.getPublicMode(),
        });
        break;
      case "notifyMissingModel":
        this.delegate.notifyMissingSpeechModel();
        break;
      case "startQuickReleaseTimer":
        this.delegate.startQuickReleaseTimer();
        break;
      case "clearQuickReleaseTimer":
        this.delegate.clearQuickReleaseTimer();
        break;
      case "markFirstAudioReceived":
        this.delegate.markFirstAudioReceived();
        break;
      case "notifyNoAudio":
        this.delegate.notifyNoAudio();
        break;
      case "notifyDurationWarning":
        this.delegate.notifyDurationWarning();
        break;
      case "notifyRecordingAutoStopped":
        this.delegate.notifyRecordingAutoStopped();
        break;
      default: {
        const exhaustive: never = command;
        throw new Error(`Unhandled sync recording FSM command: ${exhaustive}`);
      }
    }
  }

  private recordingStateForMachine(
    state: RecordingMachineState,
  ): RecordingState {
    if (state.tag === "IDLE") {
      return "idle";
    }

    if (state.tag === "STARTING") {
      return "starting";
    }

    if (this.isStoppingState(state)) {
      return "stopping";
    }

    return "recording";
  }

  private recordingModeForMachine(state: RecordingMachineState): RecordingMode {
    if (state.tag === "STARTING") {
      return state.mode;
    }

    if (state.tag === "REC_PTT" || state.tag === "PTT_Q") {
      return "ptt";
    }

    if (state.tag === "REC_HF") {
      return "hands-free";
    }

    return "idle";
  }

  private prepareStopSessionIntent(
    stopState: RecordingMachineState,
    commands: RecordingMachineCommand[],
  ): void {
    const stopCommand = commands.find(isStopRecordingMachineCommand);
    if (!stopCommand) {
      return;
    }

    if (!this.isStoppingState(stopState)) {
      this.delegate.logInvariant(
        "Recording stop command emitted outside stopping state",
        {
          command: stopCommand,
          machineState: this.describeState(stopState),
        },
      );
      return;
    }

    if (this.pendingStopSession) {
      this.delegate.logInvariant(
        "Recording stop command emitted while another stop is pending",
        {
          command: stopCommand,
          machineState: this.describeState(stopState),
        },
      );
      this.resolvePendingStopSession();
    }

    // State-change listeners can synchronously stop capture and send a final
    // chunk, so the finalization intent must be visible before we emit
    // "stopping".
    this.delegate.setStopIntent(
      this.effectiveStopCodeForState(stopState, stopCommand.code),
      performance.now(),
    );

    const { promise, resolve } = Promise.withResolvers<void>();
    this.pendingStopSession = { promise, resolve };
  }

  private emitPublicStateChanges(
    previousMachineState: RecordingMachineState,
    nextMachineState: RecordingMachineState,
  ): void {
    // FSM returns the same state reference on no-op transitions; skip derivation.
    if (previousMachineState === nextMachineState) {
      return;
    }

    const previousRecordingState =
      this.recordingStateForMachine(previousMachineState);
    const nextRecordingState = this.recordingStateForMachine(nextMachineState);
    if (previousRecordingState !== nextRecordingState) {
      this.delegate.emitStateChange(nextRecordingState, previousRecordingState);
    }

    const previousMode = this.recordingModeForMachine(previousMachineState);
    const nextMode = this.recordingModeForMachine(nextMachineState);
    if (previousMode !== nextMode) {
      this.delegate.emitModeChange(nextMode, previousMode);
    }
  }
}
