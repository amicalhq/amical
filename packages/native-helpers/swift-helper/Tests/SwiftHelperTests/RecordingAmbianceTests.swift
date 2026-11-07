import Foundation
import XCTest

@testable import SwiftHelper

private enum TestFailure: Swift.Error {
    case expected
}

private actor AsyncLatch {
    private var isOpen = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        if isOpen { return }
        await withCheckedContinuation { continuation in
            waiters.append(continuation)
        }
    }

    func open() {
        isOpen = true
        let continuations = waiters
        waiters.removeAll()
        continuations.forEach { $0.resume() }
    }
}

private final class LockedState: @unchecked Sendable {
    private let lock = NSLock()
    private var events: [String] = []
    private var completed = false

    func append(_ event: String) {
        lock.lock()
        events.append(event)
        lock.unlock()
    }

    func snapshot() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return events
    }

    func markCompleted() {
        lock.lock()
        completed = true
        lock.unlock()
    }

    func isCompleted() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return completed
    }
}

private final class FakeSoundPlayer: SoundPlayer, @unchecked Sendable {
    private let lock = NSLock()
    private var finishedHandler: ((Bool) -> Void)?
    private var decodeErrorHandler: ((Swift.Error?) -> Void)?
    private var stopped = false
    private let playStarted: XCTestExpectation

    init(playStarted: XCTestExpectation) {
        self.playStarted = playStarted
    }

    var onFinished: ((Bool) -> Void)? {
        get {
            lock.lock()
            defer { lock.unlock() }
            return finishedHandler
        }
        set {
            lock.lock()
            finishedHandler = newValue
            lock.unlock()
        }
    }

    var onDecodeError: ((Swift.Error?) -> Void)? {
        get {
            lock.lock()
            defer { lock.unlock() }
            return decodeErrorHandler
        }
        set {
            lock.lock()
            decodeErrorHandler = newValue
            lock.unlock()
        }
    }

    func play() -> Bool {
        playStarted.fulfill()
        return true
    }

    func stop() {
        lock.lock()
        stopped = true
        lock.unlock()
    }

    func invalidate() {
        lock.lock()
        finishedHandler = nil
        decodeErrorHandler = nil
        lock.unlock()
    }

    func wasStopped() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return stopped
    }

    func finishSuccessfully() {
        onFinished?(true)
    }
}

final class RecordingAmbianceTests: XCTestCase {
    func testStartWaitsForPlaybackBeforeMuting() async {
        let playbackStarted = expectation(description: "start playback began")
        let releasePlayback = AsyncLatch()
        let state = LockedState()
        let controller = RecordingAmbianceController(
            playSound: { soundName in
                state.append("play:\(soundName)")
                playbackStarted.fulfill()
                await releasePlayback.wait()
            },
            muteSystemAudio: {
                state.append("mute")
                return true
            },
            restoreSystemAudio: { true },
            log: { _ in }
        )

        let operation = Task {
            await controller.startRecording(muteSystemAudio: true, muteSounds: false)
        }
        await fulfillment(of: [playbackStarted], timeout: 1)

        XCTAssertEqual(state.snapshot(), ["play:rec-start"])
        await releasePlayback.open()
        let success = await operation.value
        XCTAssertTrue(success)
        XCTAssertEqual(state.snapshot(), ["play:rec-start", "mute"])
    }

    func testPlaybackFailureIsLoggedAndStillMutes() async {
        let state = LockedState()
        let controller = RecordingAmbianceController(
            playSound: { soundName in
                state.append("play:\(soundName)")
                throw TestFailure.expected
            },
            muteSystemAudio: {
                state.append("mute")
                return true
            },
            restoreSystemAudio: { true },
            log: { _ in state.append("log") }
        )

        let success = await controller.startRecording(
            muteSystemAudio: true,
            muteSounds: false
        )

        XCTAssertTrue(success)
        XCTAssertEqual(state.snapshot(), ["play:rec-start", "log", "mute"])
    }

    func testCompleteStartAndStopOperationsDoNotOverlap() async throws {
        let firstPlaybackStarted = expectation(description: "first playback began")
        let releaseFirstPlayback = AsyncLatch()
        let state = LockedState()
        let controller = RecordingAmbianceController(
            playSound: { soundName in
                state.append("play:\(soundName)")
                if soundName == "rec-start" {
                    firstPlaybackStarted.fulfill()
                    await releaseFirstPlayback.wait()
                }
            },
            muteSystemAudio: {
                state.append("mute")
                return true
            },
            restoreSystemAudio: {
                state.append("restore")
                return true
            },
            log: { _ in }
        )

        let start = Task {
            await controller.startRecording(muteSystemAudio: true, muteSounds: false)
        }
        await fulfillment(of: [firstPlaybackStarted], timeout: 1)
        let stop = Task {
            await controller.stopRecording(wasMuted: true, muteSounds: false)
        }

        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(state.snapshot(), ["play:rec-start"])

        await releaseFirstPlayback.open()
        let startSuccess = await start.value
        let stopSuccess = await stop.value
        XCTAssertTrue(startSuccess)
        XCTAssertTrue(stopSuccess)
        XCTAssertEqual(
            state.snapshot(),
            ["play:rec-start", "mute", "restore", "play:rec-stop"]
        )
    }

    func testStopRestoresBeforeAwaitingPlaybackAndPreservesRestoreResult() async {
        let playbackStarted = expectation(description: "stop playback began")
        let releasePlayback = AsyncLatch()
        let state = LockedState()
        let controller = RecordingAmbianceController(
            playSound: { soundName in
                state.append("play:\(soundName)")
                playbackStarted.fulfill()
                await releasePlayback.wait()
                throw TestFailure.expected
            },
            muteSystemAudio: { true },
            restoreSystemAudio: {
                state.append("restore")
                return false
            },
            log: { _ in state.append("log") }
        )

        let operation = Task {
            let success = await controller.stopRecording(wasMuted: true, muteSounds: false)
            state.markCompleted()
            return success
        }
        await fulfillment(of: [playbackStarted], timeout: 1)

        XCTAssertEqual(state.snapshot(), ["restore", "play:rec-stop"])
        XCTAssertFalse(state.isCompleted())

        await releasePlayback.open()
        let success = await operation.value
        XCTAssertFalse(success)
        XCTAssertEqual(state.snapshot(), ["restore", "play:rec-stop", "log"])
    }

    func testAsyncMutexReleasesAfterThrow() async {
        let mutex = AsyncMutex()

        do {
            try await mutex.withLock {
                throw TestFailure.expected
            }
            XCTFail("Expected the operation to throw")
        } catch TestFailure.expected {
            // Expected.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }

        let value = await mutex.withLock { 42 }
        XCTAssertEqual(value, 42)
    }

    func testPlaybackTimeoutStopsPlayerAndIgnoresItsStaleCompletion() async throws {
        let firstStarted = expectation(description: "first player started")
        let secondStarted = expectation(description: "second player started")
        let firstPlayer = FakeSoundPlayer(playStarted: firstStarted)
        let secondPlayer = FakeSoundPlayer(playStarted: secondStarted)
        let factoryLock = NSLock()
        var players = [firstPlayer, secondPlayer]
        let service = AudioService(playbackTimeout: 0.2) { _ in
            factoryLock.lock()
            defer { factoryLock.unlock() }
            return players.removeFirst()
        }

        let first = Task {
            try await service.playSound(named: "rec-start")
        }
        await fulfillment(of: [firstStarted], timeout: 1)
        let staleCompletion = firstPlayer.onFinished

        do {
            try await first.value
            XCTFail("Expected playback to time out")
        } catch let error as AudioPlaybackError {
            guard case .timedOut("rec-start") = error else {
                XCTFail("Unexpected playback error: \(error)")
                return
            }
        }
        XCTAssertTrue(firstPlayer.wasStopped())

        let secondState = LockedState()
        let second = Task {
            try await service.playSound(named: "rec-stop")
            secondState.markCompleted()
        }
        await fulfillment(of: [secondStarted], timeout: 1)

        staleCompletion?(true)
        try await Task.sleep(nanoseconds: 10_000_000)
        XCTAssertFalse(secondState.isCompleted())

        secondPlayer.finishSuccessfully()
        try await second.value
        XCTAssertTrue(secondState.isCompleted())
        XCTAssertFalse(secondPlayer.wasStopped())
    }
}
