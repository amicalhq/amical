using System;
using Interop.UIAutomationClient;

namespace WindowsHelper.Utils
{
    /// <summary>
    /// Placeholder detection helpers for UIA elements.
    /// </summary>
    public static class PlaceholderHelpers
    {
        public static bool IsPlaceholderShowing(IUIAutomationElement element)
        {
            if (element == null) return false;

            try
            {
                var pattern = element.GetCurrentPattern(Constants.UIA_ValuePatternId);
                var valuePattern = pattern as IUIAutomationValuePattern;
                if (valuePattern == null) return false;

                var value = StringHelpers.NormalizeNewlines(valuePattern.CurrentValue) ?? "";

                // Common native UIA behavior: empty value with a non-empty Name means
                // the element is showing only placeholder/label text.
                if (string.IsNullOrEmpty(value))
                {
                    return !string.IsNullOrEmpty(element.CurrentName);
                }

                // Chromium contenteditables can expose placeholder text as the current
                // value while also publishing the real placeholder via ARIA properties.
                if (MatchesAriaPlaceholder(element, value))
                {
                    return true;
                }

                return false;
            }
            catch
            {
                return false;
            }
        }

        private static bool MatchesAriaPlaceholder(IUIAutomationElement element, string value)
        {
            var ariaProperties = GetPropertyString(element, Constants.UIA_AriaPropertiesPropertyId);
            if (string.IsNullOrWhiteSpace(ariaProperties)) return false;

            foreach (var rawPart in ariaProperties.Split(';'))
            {
                var part = rawPart.Trim();
                var separatorIndex = part.IndexOf('=');
                if (separatorIndex <= 0) continue;

                var key = part.Substring(0, separatorIndex).Trim();
                if (!key.Equals("placeholder", StringComparison.OrdinalIgnoreCase) &&
                    !key.Equals("aria-placeholder", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var placeholder = StringHelpers.NormalizeNewlines(
                    part.Substring(separatorIndex + 1).Trim());
                if (TextEqualsIgnoringWhitespace(value, placeholder))
                {
                    return true;
                }
            }

            return false;
        }

        private static string? GetPropertyString(IUIAutomationElement element, int propertyId)
        {
            try
            {
                return element.GetCurrentPropertyValue(propertyId) as string;
            }
            catch
            {
                return null;
            }
        }

        private static bool TextEqualsIgnoringWhitespace(string? left, string? right)
        {
            var normalizedLeft = NormalizeForComparison(left);
            var normalizedRight = NormalizeForComparison(right);
            return normalizedLeft.Length > 0 &&
                   normalizedLeft.Equals(normalizedRight, StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizeForComparison(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "";
            return string.Join(" ", value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        }
    }
}
