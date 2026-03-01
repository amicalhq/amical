import AVFoundation
import Foundation

class AudioService: NSObject, AVAudioPlayerDelegate {
    private var audioPlayer: AVAudioPlayer?
    private var audioCompletionHandler: ((Bool) -> Void)?
    private var preloadedAudio: [String: Data] = [:]
    override init() {
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

    func playSound(named soundName: String, completion: ((Bool) -> Void)? = nil) {
        logToStderr("[AudioService] playSound called with soundName: \(soundName)")

        // Stop any currently playing sound and complete the previous handler as interrupted
        if audioPlayer?.isPlaying == true {
            logToStderr(
                "[AudioService] Sound '\(audioPlayer?.url?.lastPathComponent ?? "previous")' is playing. Stopping it."
            )
            audioPlayer?.delegate = nil
            audioPlayer?.stop()
        }
        audioPlayer = nil
        let previousHandler = audioCompletionHandler
        audioCompletionHandler = nil
        previousHandler?(false)

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
                logToStderr("[AudioService] Error: Unknown sound name '\(soundName)'. Calling completion immediately.")
                let handler = audioCompletionHandler
                audioCompletionHandler = nil
                handler?(false)
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
                    "[AudioService] Failed to start playing sound: \(soundName).mp3. Calling completion immediately."
                )
                let handler = audioCompletionHandler
                audioCompletionHandler = nil
                handler?(false)
            }
        } catch {
            logToStderr(
                "[AudioService] Error initializing AVAudioPlayer for \(soundName).mp3: \(error.localizedDescription). Calling completion immediately."
            )
            let handler = audioCompletionHandler
            audioCompletionHandler = nil
            handler?(false)
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
        } else {
            logToStderr("[AudioService] Sound did not finish successfully. Executing completion handler anyway.")
        }
        handlerToCall?(flag)
    }

    private func logToStderr(_ message: String) {
        HelperLogger.logToStderr(message)
    }
}
