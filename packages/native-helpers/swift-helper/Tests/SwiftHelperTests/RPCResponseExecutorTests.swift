import XCTest

@testable import SwiftHelper

final class RPCResponseExecutorTests: XCTestCase {
    func testSuccessPreservesRequestIDAndResult() async throws {
        let result = try JSONDecoder().decode(
            JSONAny.self,
            from: Data(#"{"success":true}"#.utf8)
        )

        let response = await RPCResponseExecutor.execute(id: "request-1") {
            result
        }

        XCTAssertEqual(response.id, "request-1")
        XCTAssertNil(response.error)
        XCTAssertEqual(
            (response.result?.value as? [String: Any])?["success"] as? Bool,
            true
        )
    }

    func testInvalidParamsReturnsInvalidParamsError() async {
        let response = await RPCResponseExecutor.execute(id: "request-2") {
            throw RPCDispatchFailure.invalidParams(
                data: nil,
                message: "Missing params for startRecording"
            )
        }

        XCTAssertEqual(response.id, "request-2")
        XCTAssertNil(response.result)
        XCTAssertEqual(response.error?.code, -32602)
        XCTAssertEqual(response.error?.message, "Missing params for startRecording")
    }

    func testDispatchFailureDecodesDataPayloadAtResponseBoundary() async {
        let response = await RPCResponseExecutor.execute(id: "request-data") {
            throw RPCDispatchFailure.invalidParams(
                data: Data(#"{"field":"invalid"}"#.utf8),
                message: "Invalid params"
            )
        }

        XCTAssertNil(response.result)
        XCTAssertEqual(response.error?.code, -32602)
        XCTAssertEqual(
            (response.error?.data?.value as? [String: Any])?["field"] as? String,
            "invalid"
        )
    }

    func testUnexpectedFailureReturnsInternalError() async {
        struct TestError: Swift.Error {}

        let response = await RPCResponseExecutor.execute(id: "request-3") {
            throw TestError()
        }

        XCTAssertEqual(response.id, "request-3")
        XCTAssertNil(response.result)
        XCTAssertEqual(response.error?.code, -32603)
    }

    func testConcurrentOperationsKeepTheirOwnRequestIDs() async {
        async let first = RPCResponseExecutor.execute(id: "slow") {
            try await Task.sleep(nanoseconds: 20_000_000)
            return nil
        }
        async let second = RPCResponseExecutor.execute(id: "fast") {
            return nil
        }

        let responses = await [first, second]

        XCTAssertEqual(responses.map(\.id), ["slow", "fast"])
        XCTAssertTrue(responses.allSatisfy { $0.error == nil })
    }
}
