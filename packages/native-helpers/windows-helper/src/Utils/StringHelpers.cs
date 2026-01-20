using System;

namespace WindowsHelper.Utils
{
    /// <summary>
    /// Direction for surrogate pair boundary adjustment.
    /// </summary>
    public enum SurrogatePairDirection
    {
        /// <summary>Move forward to valid boundary</summary>
        Forward,
        /// <summary>Move backward to valid boundary</summary>
        Backward
    }

    /// <summary>
    /// String manipulation utilities for UTF-16 handling.
    /// Matches Swift's string handling for cross-platform consistency.
    /// </summary>
    public static class StringHelpers
    {
        /// <summary>
        /// Adjust an offset to not split a UTF-16 surrogate pair.
        /// </summary>
        /// <param name="content">The string content</param>
        /// <param name="offset">The offset to adjust</param>
        /// <param name="direction">Direction to adjust if at surrogate boundary</param>
        /// <returns>Adjusted offset that doesn't split a surrogate pair</returns>
        public static int AdjustForSurrogatePairs(string? content, int offset, SurrogatePairDirection direction)
        {
            if (string.IsNullOrEmpty(content) || offset <= 0 || offset >= content.Length)
                return offset;

            var codeUnit = content[offset];

            // At low surrogate (trail) - we're in the middle of a pair
            if (char.IsLowSurrogate(codeUnit))
            {
                return direction == SurrogatePairDirection.Forward ? offset + 1 : offset - 1;
            }

            // Check if previous char is high surrogate (lead) and current is low surrogate
            // This handles the case where we're just after a high surrogate
            if (offset > 0 && char.IsHighSurrogate(content[offset - 1]) && char.IsLowSurrogate(content[offset]))
            {
                return direction == SurrogatePairDirection.Forward ? offset + 1 : offset - 1;
            }

            return offset;
        }

        /// <summary>
        /// Safe substring extraction respecting UTF-16 boundaries.
        /// </summary>
        /// <param name="content">The string content</param>
        /// <param name="start">Start index (UTF-16 code units)</param>
        /// <param name="length">Length (UTF-16 code units)</param>
        /// <returns>Substring or null if invalid parameters</returns>
        public static string? SubstringUtf16(string? content, int start, int length)
        {
            if (string.IsNullOrEmpty(content)) return null;
            if (start < 0 || start > content.Length) return null;
            if (length < 0) return null;

            var endOffset = Math.Min(start + length, content.Length);
            var actualLength = endOffset - start;

            if (actualLength <= 0) return "";

            return content.Substring(start, actualLength);
        }

        /// <summary>
        /// Clamp a value between min and max (inclusive).
        /// </summary>
        public static int Clamp(int value, int min, int max)
        {
            return Math.Max(min, Math.Min(max, value));
        }

        /// <summary>
        /// Clamp a long value between min and max (inclusive).
        /// </summary>
        public static long Clamp(long value, long min, long max)
        {
            return Math.Max(min, Math.Min(max, value));
        }

        /// <summary>
        /// Normalize newlines from Windows CRLF to Unix LF.
        /// CRITICAL: This must be called before any index calculations.
        /// </summary>
        /// <param name="content">Content potentially containing CRLF</param>
        /// <returns>Content with only LF newlines</returns>
        public static string? NormalizeNewlines(string? content)
        {
            if (content == null) return null;
            // Replace CRLF first, then any remaining standalone CR
            return content.Replace("\r\n", "\n").Replace("\r", "\n");
        }

        /// <summary>
        /// Truncate string at surrogate pair boundary.
        /// </summary>
        /// <param name="s">String to truncate</param>
        /// <param name="maxLen">Maximum length</param>
        /// <returns>Truncated string respecting surrogate boundaries</returns>
        public static string? TruncateAtSurrogateBoundary(string? s, int maxLen)
        {
            if (s == null || s.Length <= maxLen) return s;
            var end = AdjustForSurrogatePairs(s, maxLen, SurrogatePairDirection.Backward);
            return s.Substring(0, end);
        }
    }
}
