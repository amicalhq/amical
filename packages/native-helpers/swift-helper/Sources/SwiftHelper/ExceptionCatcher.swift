import Foundation
import ObjCExceptionCatcher

/// Details about a caught NSException
struct CaughtException {
    let name: String
    let reason: String
    let callStack: [String]
}

/// Result type for exception-catching operations
enum ExceptionResult<T> {
    case success(T)
    case exception(CaughtException)
}

/// Swift-friendly wrapper for catching NSExceptions
enum ExceptionCatcher {
    /// Executes a closure and catches any NSException
    /// Returns .success with result, or .exception with details
    static func `try`<T>(_ block: @escaping () -> T?) -> ExceptionResult<T?> {
        var exceptionInfo: ObjCExceptionInfo?
        let result = ObjCExceptionCatcher.catchException({
            return block() as Any?
        }, exceptionInfo: &exceptionInfo)

        if let info = exceptionInfo {
            let exception = CaughtException(
                name: info.name,
                reason: info.reason,
                callStack: info.callStackSymbols ?? []
            )
            FileHandle.standardError.write(
                "[ExceptionCatcher] NSException caught: \(info.name) - \(info.reason)\n".data(using: .utf8)!
            )
            return .exception(exception)
        }

        return .success(result as? T)
    }
}
