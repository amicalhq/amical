import AVFoundation
import Foundation

enum AudioPlaybackError: Swift.Error, LocalizedError {
    case interrupted
    case timedOut(String)
    case unknownSound(String)
    case initializationFailed(String)
    case failedToStart(String)
    case decodingFailed(String)
    case unsuccessfulCompletion(String)

    var errorDescription: String? {
        switch self {
        case .interrupted:
            return "Sound playback was interrupted"
        case .timedOut(let name):
            return "Sound playback timed out: \(name)"
        case .unknownSound(let name):
            return "Unknown sound name: \(name)"
        case .initializationFailed(let message):
            return "Could not initialize sound playback: \(message)"
        case .failedToStart(let name):
            return "Could not start sound playback: \(name)"
        case .decodingFailed(let message):
            return "Sound playback decoding failed: \(message)"
        case .unsuccessfulCompletion(let name):
            return "Sound playback did not finish successfully: \(name)"
        }
    }
}

protocol SoundPlayer: AnyObject {
    var onFinished: ((Bool) -> Void)? { get set }
    var onDecodeError: ((Swift.Error?) -> Void)? { get set }

    func play() -> Bool
    func stop()
    func invalidate()
}

private final class AVSoundPlayer: NSObject, SoundPlayer, AVAudioPlayerDelegate {
    private let callbackLock = NSLock()
    private let player: AVAudioPlayer
    private var finishedHandler: ((Bool) -> Void)?
    private var decodeErrorHandler: ((Swift.Error?) -> Void)?

    var onFinished: ((Bool) -> Void)? {
        get {
            callbackLock.lock()
            defer { callbackLock.unlock() }
            return finishedHandler
        }
        set {
            callbackLock.lock()
            finishedHandler = newValue
            callbackLock.unlock()
        }
    }

    var onDecodeError: ((Swift.Error?) -> Void)? {
        get {
            callbackLock.lock()
            defer { callbackLock.unlock() }
            return decodeErrorHandler
        }
        set {
            callbackLock.lock()
            decodeErrorHandler = newValue
            callbackLock.unlock()
        }
    }

    init(data: Data) throws {
        self.player = try AVAudioPlayer(data: data)
        super.init()
        self.player.delegate = self
    }

    func play() -> Bool {
        player.play()
    }

    func stop() {
        player.stop()
    }

    func invalidate() {
        callbackLock.lock()
        finishedHandler = nil
        decodeErrorHandler = nil
        player.delegate = nil
        callbackLock.unlock()
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        onFinished?(flag)
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Swift.Error?) {
        onDecodeError?(error)
    }
}

// Mutable playback state is confined to stateQueue. Initialization finishes
// before the service is shared with RPC tasks.
final class AudioService: @unchecked Sendable {
    typealias PlayerFactory = (Data) throws -> SoundPlayer

    private let playbackTimeout: TimeInterval
    private let playerFactory: PlayerFactory
    private let stateQueue = DispatchQueue(label: "com.amical.audio-playback")
    private var audioPlayer: SoundPlayer?
    private var audioContinuation: CheckedContinuation<Void, Swift.Error>?
    private var activeSoundName: String?
    private var timeoutWorkItem: DispatchWorkItem?
    private var preloadedAudio: [String: Data] = [:]

    init(
        playbackTimeout: TimeInterval = 1.0,
        playerFactory: @escaping PlayerFactory = { try AVSoundPlayer(data: $0) }
    ) {
        self.playbackTimeout = playbackTimeout
        self.playerFactory = playerFactory
        preloadSounds()
    }

    private func preloadSounds() {
        preloadedAudio["rec-start"] = Data(PackageResources.rec_start_mp3)
        logToStderr(
            "[AudioService] Preloaded rec-start.mp3 (\(preloadedAudio["rec-start"]?.count ?? 0) bytes)"
        )

        preloadedAudio["rec-stop"] = Data(PackageResources.rec_stop_mp3)
        logToStderr(
            "[AudioService] Preloaded rec-stop.mp3 (\(preloadedAudio["rec-stop"]?.count ?? 0) bytes)"
        )

        logToStderr("[AudioService] Audio files preloaded at startup")
    }

    func playSound(named soundName: String) async throws {
        try await withCheckedThrowingContinuation { continuation in
            stateQueue.async { [self] in
                beginPlayback(named: soundName, continuation: continuation)
            }
        }
    }

    private func beginPlayback(
        named soundName: String,
        continuation: CheckedContinuation<Void, Swift.Error>
    ) {
        logToStderr("[AudioService] playSound called with soundName: \(soundName)")

        if let previousPlayer = audioPlayer {
            logToStderr(
                "[AudioService] Sound '\(activeSoundName ?? "previous")' is playing. Stopping it."
            )
            previousPlayer.stop()
            finishPlayback(for: previousPlayer, result: .failure(.interrupted))
        }

        audioContinuation = continuation
        activeSoundName = soundName

        guard let soundData = preloadedAudio[soundName] else {
            finishPlayback(result: .failure(.unknownSound(soundName)))
            return
        }

        logToStderr(
            "[AudioService] Using preloaded audio for \(soundName).mp3 (\(soundData.count) bytes)"
        )

        do {
            let player = try playerFactory(soundData)
            audioPlayer = player
            player.onFinished = { [weak self, weak player] flag in
                guard let self, let player else { return }
                self.stateQueue.async {
                    let result: Result<Void, AudioPlaybackError> = flag
                        ? .success(())
                        : .failure(.unsuccessfulCompletion(soundName))
                    self.finishPlayback(for: player, result: result)
                }
            }
            player.onDecodeError = { [weak self, weak player] error in
                guard let self, let player else { return }
                self.stateQueue.async {
                    self.finishPlayback(
                        for: player,
                        result: .failure(
                            .decodingFailed(error?.localizedDescription ?? "Unknown decoding error")
                        )
                    )
                }
            }

            if player.play() {
                logToStderr(
                    "[AudioService] Playing sound: \(soundName).mp3. Delegate will handle completion."
                )
                scheduleTimeout(for: player, soundName: soundName)
            } else {
                finishPlayback(for: player, result: .failure(.failedToStart(soundName)))
            }
        } catch {
            finishPlayback(result: .failure(.initializationFailed(error.localizedDescription)))
        }
    }

    private func scheduleTimeout(for player: SoundPlayer, soundName: String) {
        let workItem = DispatchWorkItem { [weak self, weak player] in
            guard let self, let player else { return }
            guard let activePlayer = self.audioPlayer, activePlayer === player else { return }

            self.logToStderr("[AudioService] Playback timed out for \(soundName).mp3")
            player.stop()
            self.finishPlayback(for: player, result: .failure(.timedOut(soundName)))
        }
        timeoutWorkItem = workItem
        stateQueue.asyncAfter(deadline: .now() + playbackTimeout, execute: workItem)
    }

    private func finishPlayback(
        for player: SoundPlayer? = nil,
        result: Result<Void, AudioPlaybackError>
    ) {
        if let player {
            guard let activePlayer = audioPlayer, activePlayer === player else {
                logToStderr("[AudioService] Ignoring completion from an inactive player")
                return
            }
        }

        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil

        let continuation = audioContinuation
        let player = audioPlayer
        audioContinuation = nil
        activeSoundName = nil
        audioPlayer = nil
        player?.invalidate()

        switch result {
        case .success:
            continuation?.resume()
        case .failure(let error):
            logToStderr("[AudioService] \(error.localizedDescription)")
            continuation?.resume(throwing: error)
        }
    }

    private func logToStderr(_ message: String) {
        HelperLogger.logToStderr(message)
    }
}
