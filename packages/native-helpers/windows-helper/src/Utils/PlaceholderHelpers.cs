using System;
using System.Collections.Generic;
using Interop.UIAutomationClient;
using WindowsHelper.Services;

namespace WindowsHelper.Utils
{
    /// <summary>
    /// Placeholder detection helpers for UIA elements.
    /// </summary>
    public static class PlaceholderHelpers
    {
        private const int PLACEHOLDER_DESCENDANT_MAX_DEPTH = 3;
        private const int PLACEHOLDER_DESCENDANT_MAX_NODES = 32;
        private const int PLACEHOLDER_TEXT_MAX_DEPTH = 2;
        private const int PLACEHOLDER_TEXT_MAX_NODES = 16;

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

                // Quill editors mark an empty editor with ql-blank. Chromium exposes
                // the visible placeholder as ValuePattern/TextPattern text in that state.
                if (HasClass(element, "ql-blank"))
                {
                    return true;
                }

                // ProseMirror-based editors can expose placeholder text as the edit
                // value while the actual placeholder marker lives in a raw child
                // subtree. Keep this narrow: require an exact "placeholder" class
                // token and visible descendant text that matches the edit value.
                if (MatchesDescendantPlaceholder(element, value))
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

        private static bool MatchesDescendantPlaceholder(IUIAutomationElement element, string value)
        {
            var normalizedValue = NormalizeForComparison(value);
            if (normalizedValue.Length == 0) return false;

            var walker = UIAutomationService.RawViewWalker;
            var queue = new Queue<(IUIAutomationElement Element, int Depth)>();
            queue.Enqueue((element, 0));

            var visited = 0;
            while (queue.Count > 0 && visited < PLACEHOLDER_DESCENDANT_MAX_NODES)
            {
                var (current, depth) = queue.Dequeue();
                if (depth >= PLACEHOLDER_DESCENDANT_MAX_DEPTH) continue;

                foreach (var child in EnumerateChildren(walker, current))
                {
                    if (visited >= PLACEHOLDER_DESCENDANT_MAX_NODES) break;
                    visited++;

                    if (HasClass(child, "placeholder") &&
                        ElementOrDescendantTextMatches(child, normalizedValue))
                    {
                        return true;
                    }

                    if (depth + 1 < PLACEHOLDER_DESCENDANT_MAX_DEPTH)
                    {
                        queue.Enqueue((child, depth + 1));
                    }
                }
            }

            return false;
        }

        private static bool ElementOrDescendantTextMatches(IUIAutomationElement element, string normalizedValue)
        {
            var walker = UIAutomationService.RawViewWalker;
            var queue = new Queue<(IUIAutomationElement Element, int Depth)>();
            queue.Enqueue((element, 0));

            var visited = 0;
            while (queue.Count > 0 && visited < PLACEHOLDER_TEXT_MAX_NODES)
            {
                var (current, depth) = queue.Dequeue();
                visited++;

                var text = GetElementText(current);
                if (NormalizeForComparison(text).Equals(normalizedValue, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }

                if (depth >= PLACEHOLDER_TEXT_MAX_DEPTH) continue;

                foreach (var child in EnumerateChildren(walker, current))
                {
                    if (visited + queue.Count >= PLACEHOLDER_TEXT_MAX_NODES) break;
                    queue.Enqueue((child, depth + 1));
                }
            }

            return false;
        }

        /// <summary>
        /// Yields an element's children (first child, then its siblings) using the
        /// given walker. COM failures terminate enumeration via the Try* wrappers.
        /// </summary>
        private static IEnumerable<IUIAutomationElement> EnumerateChildren(
            IUIAutomationTreeWalker walker,
            IUIAutomationElement element)
        {
            var child = TryGetFirstChild(walker, element);
            while (child != null)
            {
                yield return child;
                child = TryGetNextSibling(walker, child);
            }
        }

        private static IUIAutomationElement? TryGetFirstChild(
            IUIAutomationTreeWalker walker,
            IUIAutomationElement element)
        {
            try
            {
                return walker.GetFirstChildElement(element);
            }
            catch
            {
                return null;
            }
        }

        private static IUIAutomationElement? TryGetNextSibling(
            IUIAutomationTreeWalker walker,
            IUIAutomationElement element)
        {
            try
            {
                return walker.GetNextSiblingElement(element);
            }
            catch
            {
                return null;
            }
        }

        private static string? GetElementText(IUIAutomationElement element)
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(element.CurrentName))
                {
                    return element.CurrentName;
                }
            }
            catch
            {
            }

            try
            {
                var textPattern = element.GetCurrentPattern(Constants.UIA_TextPatternId) as IUIAutomationTextPattern;
                var text = textPattern?.DocumentRange?.GetText(-1);
                if (!string.IsNullOrWhiteSpace(text))
                {
                    return StringHelpers.NormalizeNewlines(text);
                }
            }
            catch
            {
            }

            try
            {
                var valuePattern = element.GetCurrentPattern(Constants.UIA_ValuePatternId) as IUIAutomationValuePattern;
                var value = valuePattern?.CurrentValue;
                if (!string.IsNullOrWhiteSpace(value))
                {
                    return StringHelpers.NormalizeNewlines(value);
                }
            }
            catch
            {
            }

            return null;
        }

        private static bool HasClass(IUIAutomationElement element, string className)
        {
            try
            {
                var currentClassName = element.CurrentClassName;
                if (string.IsNullOrWhiteSpace(currentClassName)) return false;

                foreach (var token in currentClassName.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
                {
                    if (token.Equals(className, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                }
            }
            catch
            {
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
