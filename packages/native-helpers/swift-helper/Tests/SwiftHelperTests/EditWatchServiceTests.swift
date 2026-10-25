import XCTest

@testable import SwiftHelper

/// Covers the id-only paths of the edit watch; they need no accessibility access.
final class EditWatchServiceTests: XCTestCase {
    func testReadWithUnknownIdAnswersUnknownWatch() async throws {
        let service = EditWatchService()

        let result = try await service.read(watchID: "not-a-current-watch")

        XCTAssertEqual(result.readStatus, .unknownWatch)
        XCTAssertNil(result.text)
        XCTAssertNil(result.selection)
    }

    func testStopWithUnknownIdDoesNothing() async throws {
        let service = EditWatchService()

        let result = try await service.stop(watchID: "not-a-current-watch")

        XCTAssertFalse(result.stopped)
    }
}
