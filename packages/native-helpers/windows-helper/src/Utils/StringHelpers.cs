using System;

namespace WindowsHelper.Utils
{
    /// <summary>
    /// String manipulation utilities for UTF-16 handling.
    /// </summary>
    public static class StringHelpers
    {
        /// <summary>
        /// Unicode BOM (Byte Order Mark) character.
        /// Some apps (e.g., Discord on Windows) return BOM when text fields are empty.
        /// </summary>
        private const char BOM = '\uFEFF';

        /// <summary>
        /// Object Replacement Character - used in rich text for embedded objects.
        /// Should be stripped as it's not meaningful text content.
        /// </summary>
        private const char OBJ_REPLACEMENT = '\uFFFC';

        /// <summary>
        /// Normalize text content: remove special chars and normalize newlines.
        /// CRITICAL: This must be called before any index calculations.
        /// </summary>
        /// <param name="content">Content potentially containing special chars and/or CRLF</param>
        /// <returns>Normalized content with special chars removed and only LF newlines</returns>
        public static string? NormalizeNewlines(string? content)
        {
            if (content == null) return null;
            // Strip BOM and Object Replacement characters
            // Then replace CRLF, then any remaining standalone CR
            return content
                .Replace(BOM.ToString(), "")
                .Replace(OBJ_REPLACEMENT.ToString(), "")
                .Replace("\r\n", "\n")
                .Replace("\r", "\n");
        }

        /// <summary>
        /// Adjust an offset to not split a UTF-16 surrogate pair.
        /// If the offset lands on a low surrogate (trail), move backward to include the full pair.
        /// </summary>
        /// <param name="content">The string content</param>
        /// <param name="offset">The offset to adjust</param>
        /// <returns>Adjusted offset that doesn't split a surrogate pair</returns>
        public static int AdjustForSurrogatePair(string content, int offset)
        {
            if (string.IsNullOrEmpty(content) || offset <= 0 || offset >= content.Length)
                return offset;

            // If we're at a low surrogate (trail), back up one to include the high surrogate
            if (char.IsLowSurrogate(content[offset]))
            {
                return offset - 1;
            }

            return offset;
        }

        /// <summary>
        /// Truncate string at a surrogate-safe boundary.
        /// </summary>
        /// <param name="content">String to truncate</param>
        /// <param name="maxLength">Maximum length</param>
        /// <returns>Truncated string that doesn't split surrogate pairs</returns>
        public static string TruncateAtSurrogateBoundary(string content, int maxLength)
        {
            if (string.IsNullOrEmpty(content) || content.Length <= maxLength)
                return content ?? "";

            var safeEnd = AdjustForSurrogatePair(content, maxLength);
            return content.Substring(0, safeEnd);
        }
    }
}
