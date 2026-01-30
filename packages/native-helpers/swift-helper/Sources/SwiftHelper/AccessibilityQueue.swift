import Foundation

/// Dedicated queue for accessibility operations to prevent blocking other RPC operations
class AccessibilityQueue {
    static let shared = AccessibilityQueue()

    /// Serial queue for accessibility operations with high priority
    private let queue = DispatchQueue(
        label: "com.vox.accessibility",
        qos: .userInitiated,
        attributes: [],
        autoreleaseFrequency: .workItem
    )

    /// Semaphore to limit concurrent accessibility operations
    private let semaphore = DispatchSemaphore(value: 1)

    private init() {}

    /// Execute work asynchronously on the accessibility queue
    func async(execute work: @escaping () -> Void) {
        queue.async {
            self.semaphore.wait()
            defer { self.semaphore.signal() }
            work()
        }
    }

    /// Execute work synchronously on the accessibility queue and return result
    func sync<T>(execute work: () throws -> T) rethrows -> T {
        try queue.sync {
            semaphore.wait()
            defer { semaphore.signal() }
            return try work()
        }
    }
}
