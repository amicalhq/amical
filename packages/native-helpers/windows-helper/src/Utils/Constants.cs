namespace WindowsHelper.Utils
{
    /// <summary>
    /// Centralized configuration constants.
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
        /// Default depth for parent chain traversal
        /// </summary>
        public const int PARENT_CHAIN_MAX_DEPTH = 10;

        /// <summary>
        /// Maximum depth to search for window element (deeper than normal parent chain
        /// because browser windows can be 12+ levels up from focused element)
        /// </summary>
        public const int WINDOW_SEARCH_MAX_DEPTH = 25;

        // =============================================================================
        // Timeouts (milliseconds)
        // =============================================================================

        /// <summary>
        /// Timeout for parent chain traversal
        /// </summary>
        public const int PARENT_WALK_TIMEOUT_MS = 1000;

        /// <summary>
        /// Best-effort timeout for extraction (milliseconds)
        /// </summary>
        public const double EXTRACTION_TIMEOUT_MS = 1000.0;

        // =============================================================================
        // Search Limits
        // =============================================================================

        /// <summary>
        /// Maximum depth for finding Edit descendants
        /// </summary>
        public const int EDIT_SEARCH_MAX_DEPTH = 8;

        /// <summary>
        /// Maximum Edit elements to find
        /// </summary>
        public const int EDIT_SEARCH_MAX_EDITS = 10;

        // =============================================================================
        // UIA Control Type IDs (only those used in logic)
        // =============================================================================

        public const int UIA_EditControlTypeId = 50004;
        public const int UIA_GroupControlTypeId = 50026;
        public const int UIA_DocumentControlTypeId = 50030;
        public const int UIA_WindowControlTypeId = 50032;

        // =============================================================================
        // UIA Pattern IDs
        // =============================================================================

        public const int UIA_ValuePatternId = 10002;
        public const int UIA_TextPatternId = 10014;
    }
}
