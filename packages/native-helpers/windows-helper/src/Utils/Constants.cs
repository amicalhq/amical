using System.Collections.Generic;

namespace WindowsHelper.Utils
{
    /// <summary>
    /// Centralized configuration constants matching Swift's Constants.swift.
    /// All magic numbers, timeouts, depths, and configuration values in one place.
    /// </summary>
    public static class Constants
    {
        // =============================================================================
        // Content Limits (UTF-16 code units)
        // =============================================================================

        /// <summary>
        /// Maximum UTF-16 code units for pre/post selection context
        /// </summary>
        public const int MAX_CONTEXT_LENGTH = 500;

        /// <summary>
        /// Maximum UTF-16 code units for full content before truncation
        /// </summary>
        public const int MAX_FULL_CONTENT_LENGTH = 50_000;

        /// <summary>
        /// Padding around selection when windowing content (UTF-16 code units)
        /// </summary>
        public const int WINDOW_PADDING = 25_000;

        // =============================================================================
        // Tree Traversal Limits
        // =============================================================================

        /// <summary>
        /// Default maximum depth for generic tree walks (BFS)
        /// </summary>
        public const int TREE_WALK_MAX_DEPTH = 8;

        /// <summary>
        /// Maximum elements to visit during tree searches
        /// </summary>
        public const int TREE_WALK_MAX_ELEMENTS = 100;

        /// <summary>
        /// Depth for touching descendants to trigger lazy loading
        /// </summary>
        public const int TOUCH_DESCENDANTS_MAX_DEPTH = 3;

        /// <summary>
        /// Maximum children to touch per level during lazy loading
        /// </summary>
        public const int TOUCH_DESCENDANTS_PREFIX_LIMIT = 8;

        /// <summary>
        /// Default depth for parent chain traversal
        /// </summary>
        public const int PARENT_CHAIN_MAX_DEPTH = 10;

        /// <summary>
        /// Depth limit for descendant-or-equal check (infinite loop guard)
        /// Matches Swift's DESCENDANT_CHECK_MAX_DEPTH
        /// </summary>
        public const int DESCENDANT_CHECK_MAX_DEPTH = 20;

        // =============================================================================
        // Document Search (maps to Swift's WebArea search)
        // =============================================================================

        /// <summary>
        /// Default depth for finding Documents in descendants
        /// </summary>
        public const int DOCUMENT_SEARCH_MAX_DEPTH = 10;

        /// <summary>
        /// Maximum elements to visit when finding Documents
        /// </summary>
        public const int DOCUMENT_SEARCH_MAX_ELEMENTS = 200;

        /// <summary>
        /// Depth for Document ancestor search (increased for deeply nested Electron apps like Notion)
        /// </summary>
        public const int DOCUMENT_ANCESTOR_SEARCH_DEPTH = 15;

        // =============================================================================
        // Deep Text Element Search (maps to Swift's findDeepestTextElement)
        // =============================================================================

        /// <summary>
        /// Default depth for finding deepest text element
        /// </summary>
        public const int FIND_TEXT_ELEMENT_MAX_DEPTH = 10;

        /// <summary>
        /// Maximum elements to visit when finding text element
        /// </summary>
        public const int FIND_TEXT_ELEMENT_MAX_ELEMENTS = 200;

        // =============================================================================
        // Browser URL Search
        // =============================================================================

        /// <summary>
        /// Depth for Chromium browser URL search (deeper due to complex DOM)
        /// </summary>
        public const int CHROMIUM_URL_SEARCH_DEPTH = 30;

        /// <summary>
        /// Depth for non-Chromium browser URL search
        /// </summary>
        public const int NON_CHROMIUM_URL_SEARCH_DEPTH = 3;

        // =============================================================================
        // Performance (best-effort)
        // =============================================================================

        /// <summary>
        /// Best-effort timeout for extraction (milliseconds)
        /// </summary>
        public const double EXTRACTION_TIMEOUT_MS = 600.0;

        // =============================================================================
        // Browser Process Names
        // =============================================================================

        /// <summary>
        /// Known browser process names for role mapping and URL extraction.
        /// Used to determine if Document should map to AXWebArea vs AXTextArea.
        /// </summary>
        public static readonly HashSet<string> BrowserProcessNames = new HashSet<string>(
            System.StringComparer.OrdinalIgnoreCase)
        {
            "chrome",
            "msedge",
            "firefox",
            "brave",
            "opera",
            "vivaldi",
            "chromium"
        };
    }
}
