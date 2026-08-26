final class RecordingAmbianceController {
    typealias PlaySound = (String) async throws -> Void

    private let gate = AsyncMutex()
    private let playSound: PlaySound
    private let muteSystemAudio: () -> Bool
    private let restoreSystemAudio: () -> Bool
    private let log: (String) -> Void

    init(
        playSound: @escaping PlaySound,
        muteSystemAudio: @escaping () -> Bool,
        restoreSystemAudio: @escaping () -> Bool,
        log: @escaping (String) -> Void
    ) {
        self.playSound = playSound
        self.muteSystemAudio = muteSystemAudio
        self.restoreSystemAudio = restoreSystemAudio
        self.log = log
    }

    func startRecording(muteSystemAudio shouldMute: Bool, muteSounds: Bool) async -> Bool {
        await gate.withLock { [self] in
            if !muteSounds {
                await playBestEffort(named: "rec-start")
            }
            return !shouldMute || muteSystemAudio()
        }
    }

    func stopRecording(wasMuted: Bool, muteSounds: Bool) async -> Bool {
        await gate.withLock { [self] in
            let success = !wasMuted || restoreSystemAudio()
            if !muteSounds {
                await playBestEffort(named: "rec-stop")
            }
            return success
        }
    }

    private func playBestEffort(named soundName: String) async {
        do {
            try await playSound(soundName)
        } catch {
            log("[IOBridge] Error playing \(soundName): \(error.localizedDescription)")
        }
    }
}
