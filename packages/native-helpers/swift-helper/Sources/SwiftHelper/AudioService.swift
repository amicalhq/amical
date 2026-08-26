import AVFoundation
import Foundation

enum AudioPlaybackError: Swift.Error, LocalizedError {
    case interrupted
    case unknownSound(String)
    case initializationFailed(String)
    case failedToStart(String)
    case decodingFailed(String)
    case unsuccessfulCompletion(String)

    var errorDescription: String? {
        switch self {
        case .interrupted:
            return "Sound playback was interrupted"
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

class AudioService: NSObject, AVAudioPlayerDelegate {
    private var audioPlayer: AVAudioPlayer?
    private var audioContinuation: CheckedContinuation<Void, Swift.Error>?
    private var activeSoundName: String?
    private var preloadedAudio: [String: Data] = [:]

    override init() {
        super.init()
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
            beginPlayback(named: soundName, continuation: continuation)
        }
    }

    private func beginPlayback(
        named soundName: String,
        continuation: CheckedContinuation<Void, Swift.Error>
    ) {
        logToStderr("[AudioService] playSound called with soundName: \(soundName)")

        if let previousContinuation = audioContinuation {
            logToStderr(
                "[AudioService] Sound '\(activeSoundName ?? "previous")' is playing. Stopping it."
            )
            audioPlayer?.delegate = nil
            audioPlayer?.stop()
            audioPlayer = nil
            audioContinuation = nil
            activeSoundName = nil
            previousContinuation.resume(throwing: AudioPlaybackError.interrupted)
        }

        audioContinuation = continuation
        activeSoundName = soundName

        let soundData: Data
        if let preloaded = preloadedAudio[soundName] {
            logToStderr(
                "[AudioService] Using preloaded audio for \(soundName).mp3 (\(preloaded.count) bytes)"
            )
            soundData = preloaded
        } else {
            switch soundName {
            case "rec-start":
                soundData = Data(PackageResources.rec_start_mp3)
            case "rec-stop":
                soundData = Data(PackageResources.rec_stop_mp3)
            default:
                finishPlayback(.failure(.unknownSound(soundName)))
                return
            }
        }

        do {
            audioPlayer = try AVAudioPlayer(data: soundData)
            audioPlayer?.delegate = self

            if audioPlayer?.play() == true {
                logToStderr(
                    "[AudioService] Playing sound: \(soundName).mp3. Delegate will handle completion."
                )
            } else {
                finishPlayback(.failure(.failedToStart(soundName)))
            }
        } catch {
            finishPlayback(.failure(.initializationFailed(error.localizedDescription)))
        }
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let soundName = activeSoundName ?? "unknown"
        logToStderr(
            "[AudioService] Sound playback finished (player URL: \(player.url?.lastPathComponent ?? "unknown"), successfully: \(flag))."
        )

        if flag {
            finishPlayback(.success(()))
        } else {
            finishPlayback(.failure(.unsuccessfulCompletion(soundName)))
        }
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Swift.Error?) {
        finishPlayback(
            .failure(.decodingFailed(error?.localizedDescription ?? "Unknown decoding error"))
        )
    }

    private func finishPlayback(_ result: Result<Void, AudioPlaybackError>) {
        let continuation = audioContinuation
        audioContinuation = nil
        activeSoundName = nil
        audioPlayer?.delegate = nil
        audioPlayer = nil

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
