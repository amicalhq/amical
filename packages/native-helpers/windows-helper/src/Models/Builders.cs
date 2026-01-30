using System;
using System.Collections.Generic;
using System.Diagnostics;
using WindowsHelper.Utils;

namespace WindowsHelper.Models
{
    /// <summary>
    /// Builder for creating TextSelection with proper defaults.
    /// Matches Swift's TextSelectionBuilder.
    /// </summary>
    public class TextSelectionBuilder
    {
        public string? SelectedText { get; set; } = null;
        public string? FullContent { get; set; } = null;
        public string? PreSelectionText { get; set; } = null;
        public string? PostSelectionText { get; set; } = null;
        public SelectionRange? SelectionRange { get; set; } = null;
        public bool IsEditable { get; set; } = false;
        public The0 ExtractionMethod { get; set; } = The0.None;
        public bool HasMultipleRanges { get; set; } = false;
        public bool IsPlaceholder { get; set; } = false;
        public bool IsSecure { get; set; } = false;
        public bool FullContentTruncated { get; set; } = false;

        /// <summary>
        /// Build the TextSelection with current values.
        /// </summary>
        public TextSelection Build()
        {
            return new TextSelection
            {
                ExtractionMethod = ExtractionMethod,
                FullContent = FullContent,
                FullContentTruncated = FullContentTruncated,
                HasMultipleRanges = HasMultipleRanges,
                IsEditable = IsEditable,
                IsPlaceholder = IsPlaceholder,
                IsSecure = IsSecure,
                PostSelectionText = PostSelectionText,
                PreSelectionText = PreSelectionText,
                SelectedText = SelectedText,
                SelectionRange = SelectionRange
            };
        }

        /// <summary>
        /// Create a secure field result (all content fields suppressed).
        /// Matches Swift's secureField static method.
        /// </summary>
        public static TextSelection SecureField(bool isEditable)
        {
            return new TextSelection
            {
                ExtractionMethod = The0.None,
                FullContent = null,
                FullContentTruncated = false,
                HasMultipleRanges = false,
                IsEditable = isEditable,
                IsPlaceholder = false,
                IsSecure = true,
                PostSelectionText = null,
                PreSelectionText = null,
                SelectedText = null,
                SelectionRange = null  // Suppressed to prevent password length leakage
            };
        }
    }

    /// <summary>
    /// Builder for creating extraction Metrics.
    /// Matches Swift's ExtractionMetricsBuilder.
    /// </summary>
    public class MetricsBuilder
    {
        private readonly Stopwatch _stopwatch = Stopwatch.StartNew();

        /// <summary>
        /// Whether TextPattern extraction was attempted (maps to textMarkerAttempted in JSON)
        /// </summary>
        public bool TextPatternAttempted { get; set; } = false;

        /// <summary>
        /// Whether TextPattern extraction succeeded (maps to textMarkerSucceeded in JSON)
        /// </summary>
        public bool TextPatternSucceeded { get; set; } = false;

        /// <summary>
        /// List of fallback methods used (enum values will be serialized)
        /// </summary>
        public List<The0> FallbacksUsed { get; } = new List<The0>();

        /// <summary>
        /// List of non-PII error messages
        /// </summary>
        public List<string> Errors { get; } = new List<string>();

        /// <summary>
        /// Whether extraction timed out (set automatically based on total time)
        /// </summary>
        public bool TimedOut { get; set; } = false;

        // Document retry metrics (maps to Swift's webAreaRetry)
        /// <summary>
        /// Whether Document retry was attempted (maps to webAreaRetryAttempted in JSON)
        /// </summary>
        public bool DocumentRetryAttempted { get; set; } = false;

        /// <summary>
        /// Whether a Document element was found (maps to webAreaFound in JSON)
        /// </summary>
        public bool DocumentFound { get; set; } = false;

        /// <summary>
        /// Whether Document retry succeeded (maps to webAreaRetrySucceeded in JSON)
        /// </summary>
        public bool DocumentRetrySucceeded { get; set; } = false;

        /// <summary>
        /// Record a fallback method being used.
        /// </summary>
        public void RecordFallback(The0 method)
        {
            FallbacksUsed.Add(method);
        }

        /// <summary>
        /// Record an error message (should not contain PII).
        /// </summary>
        public void RecordError(string message)
        {
            Errors.Add(message);
        }

        /// <summary>
        /// Build the Metrics with current values.
        /// </summary>
        public Metrics Build()
        {
            var totalTimeMs = _stopwatch.Elapsed.TotalMilliseconds;
            var timedOut = totalTimeMs > Constants.EXTRACTION_TIMEOUT_MS;

            return new Metrics
            {
                TextMarkerAttempted = TextPatternAttempted,  // Maps to textMarkerAttempted in JSON
                TextMarkerSucceeded = TextPatternSucceeded,
                FallbacksUsed = FallbacksUsed,
                Errors = Errors,
                TimedOut = timedOut,
                TotalTimeMs = totalTimeMs,
                WebAreaRetryAttempted = DocumentRetryAttempted,  // Maps to webAreaRetryAttempted
                WebAreaFound = DocumentFound,
                WebAreaRetrySucceeded = DocumentRetrySucceeded
            };
        }
    }

    /// <summary>
    /// Result from text extraction attempt (internal use).
    /// </summary>
    public class TextExtractionResult
    {
        public string? SelectedText { get; set; }
        public SelectionRange? SelectionRange { get; set; }
        public bool HasMultipleRanges { get; set; }

        // For large docs: content is included directly (windowed)
        public string? FullContent { get; set; }
        public bool FullContentTruncated { get; set; }
        public bool IsLargeDoc { get; set; }
    }

    /// <summary>
    /// Result from window-around-selection operation.
    /// </summary>
    public struct WindowResult
    {
        public string WindowedContent;
        public SelectionRange? AdjustedRange;
        public string? SelectedText;
        public bool Truncated;
    }
}
