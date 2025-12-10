import AVFoundation
import Foundation

class AudioService: NSObject, AVAudioPlayerDelegate {
    private var audioPlayer: AVAudioPlayer?
    private var audioCompletionHandler: (() -> Void)?
    private var preloadedAudio: [String: Data] = [:]
    private let dateFormatter: DateFormatter

    override init() {
        self.dateFormatter = DateFormatter()
        self.dateFormatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        super.init()
        preloadSounds()
    }

    private func preloadSounds() {
        // Preload audio files at startup for faster playback
        preloadedAudio["rec-start"] = Data(PackageResources.rec_start_mp3)
        logToStderr("[AudioService] Preloaded rec-start.mp3 (\(preloadedAudio["rec-start"]?.count ?? 0) bytes)")

        preloadedAudio["rec-stop"] = Data(PackageResources.rec_stop_mp3)
        logToStderr("[AudioService] Preloaded rec-stop.mp3 (\(preloadedAudio["rec-stop"]?.count ?? 0) bytes)")

        logToStderr("[AudioService] Audio files preloaded at startup")
    }

    func playSound(named soundName: String, completion: (() -> Void)? = nil) {
        logToStderr("[AudioService] playSound called with soundName: \(soundName)")

        // Stop any currently playing sound
        if audioPlayer?.isPlaying == true {
            logToStderr(
                "[AudioService] Sound '\(audioPlayer?.url?.lastPathComponent ?? "previous")' is playing. Stopping it."
            )
            audioPlayer?.delegate = nil
            audioPlayer?.stop()
        }
        audioPlayer = nil
        audioCompletionHandler = nil

        audioCompletionHandler = completion

        // Use preloaded audio data (fast) or fall back to loading from resources
        let soundData: Data
        if let preloaded = preloadedAudio[soundName] {
            logToStderr("[AudioService] Using preloaded audio for \(soundName).mp3 (\(preloaded.count) bytes)")
            soundData = preloaded
        } else {
            logToStderr("[AudioService] Audio not preloaded, loading from PackageResources: \(soundName)")
            switch soundName {
            case "rec-start":
                soundData = Data(PackageResources.rec_start_mp3)
            case "rec-stop":
                soundData = Data(PackageResources.rec_stop_mp3)
            default:
                logToStderr("[AudioService] Error: Unknown sound name '\(soundName)'. Completion will not be called.")
                audioCompletionHandler = nil
                return
            }
        }

        do {
            audioPlayer = try AVAudioPlayer(data: soundData)
            audioPlayer?.delegate = self

            if audioPlayer?.play() == true {
                logToStderr("[AudioService] Playing sound: \(soundName).mp3. Delegate will handle completion.")
            } else {
                logToStderr(
                    "[AudioService] Failed to start playing sound: \(soundName).mp3. Completion will not be called."
                )
                audioCompletionHandler = nil
            }
        } catch {
            logToStderr(
                "[AudioService] Error initializing AVAudioPlayer for \(soundName).mp3: \(error.localizedDescription). Completion will not be called."
            )
            audioCompletionHandler = nil
        }
    }

    // MARK: - AVAudioPlayerDelegate

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        logToStderr(
            "[AudioService] Sound playback finished (player URL: \(player.url?.lastPathComponent ?? "unknown"), successfully: \(flag))."
        )

        let handlerToCall = audioCompletionHandler
        audioCompletionHandler = nil

        if flag {
            logToStderr("[AudioService] Sound finished successfully. Executing completion handler.")
            handlerToCall?()
        } else {
            logToStderr("[AudioService] Sound did not finish successfully. Not executing completion handler.")
        }
    }

    private func logToStderr(_ message: String) {
        let timestamp = dateFormatter.string(from: Date())
        let logMessage = "[\(timestamp)] \(message)\n"
        FileHandle.standardError.write(logMessage.data(using: .utf8)!)
    }
}
