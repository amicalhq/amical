import Foundation
import CoreGraphics

// =============================================================================
// Constants - Centralized Configuration for Accessibility Extraction
// =============================================================================
// All magic numbers, timeouts, depths, and configuration values in one place.
// This makes it easier to tune, document, and understand system behavior.
// =============================================================================

// MARK: - Content Limits

/// Maximum UTF-16 code units for pre/post selection context
let MAX_CONTEXT_LENGTH = 500

/// Maximum UTF-16 code units for full content before truncation
let MAX_FULL_CONTENT_LENGTH = 50_000

/// Padding around selection when windowing content (UTF-16 code units)
let WINDOW_PADDING = 25_000

// MARK: - Tree Traversal Limits

/// Default maximum depth for generic tree walks (BFS)
let TREE_WALK_MAX_DEPTH = 8

/// Maximum elements to visit during tree searches
let TREE_WALK_MAX_ELEMENTS = 100

/// Depth for touching descendants to trigger lazy loading
let TOUCH_DESCENDANTS_MAX_DEPTH = 3

/// Maximum children to touch per level during lazy loading
let TOUCH_DESCENDANTS_PREFIX_LIMIT = 8

/// Default depth for parent chain traversal
let PARENT_CHAIN_MAX_DEPTH = 10

/// Depth limit for descendant-or-equal check (infinite loop guard)
let DESCENDANT_CHECK_MAX_DEPTH = 20

/// Default depth for finding deepest text element
let FIND_TEXT_ELEMENT_MAX_DEPTH = 10

/// Maximum elements to visit when finding text element
let FIND_TEXT_ELEMENT_MAX_ELEMENTS = 200

/// Default depth for finding WebAreas in descendants
let FIND_WEB_AREAS_MAX_DEPTH = 10

/// Maximum elements to visit when finding WebAreas
let FIND_WEB_AREAS_MAX_ELEMENTS = 200

// MARK: - Browser-Specific Depths

/// Depth for Chromium browser URL search (deeper due to complex DOM)
let CHROMIUM_URL_SEARCH_DEPTH = 30

/// Depth for non-Chromium browser URL search
let NON_CHROMIUM_URL_SEARCH_DEPTH = 3

/// Depth for WebArea ancestor search (increased for deeply nested Electron apps like Notion)
let WEB_AREA_ANCESTOR_SEARCH_DEPTH = 15

// MARK: - Timeouts

/// Best-effort timeout for extraction (milliseconds)
let EXTRACTION_TIMEOUT_MS: Double = 600.0

/// Delay before restoring pasteboard after paste (seconds)
let PASTE_RESTORE_DELAY_SECONDS: Double = 0.2

// MARK: - Virtual Key Codes (macOS)

/// Virtual key code for 'V' key
let VK_V: CGKeyCode = 9

/// Virtual key code for Command key
let VK_COMMAND: CGKeyCode = 55

/// Virtual key code for Function (Fn) key
let VK_FUNCTION: CGKeyCode = 0x3F

// MARK: - Accessibility Tree Building

/// Maximum recursion depth for building accessibility tree
let ACCESSIBILITY_TREE_MAX_DEPTH = 10

// MARK: - App Lists

/// Apps that need manual accessibility enabling (browsers)
let appsRequiringManualAX: Set<String> = [
    "com.google.Chrome",
    "org.mozilla.firefox",
    "com.microsoft.edgemac",
    "com.apple.Safari",
    "com.brave.Browser",
    "com.operasoftware.Opera",
    "com.vivaldi.Vivaldi"
]
