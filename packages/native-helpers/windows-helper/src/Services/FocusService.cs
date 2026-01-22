using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Interop.UIAutomationClient;
using WindowsHelper.Models;
using WindowsHelper.Utils;

namespace WindowsHelper.Services
{
    /// <summary>
    /// Result from finding a text-capable element.
    /// </summary>
    public struct FocusResult
    {
        /// <summary>The text-capable element found</summary>
        public IUIAutomationElement Element;
        /// <summary>True if found via ancestor search, false if original element was text-capable</summary>
        public bool WasSearched;
    }

    /// <summary>
    /// Service for focus resolution and element information extraction.
    /// Uses COM interop with minimal approach (no descendant search).
    /// </summary>
    public static class FocusService
    {
        /// <summary>
        /// Get the currently focused element.
        /// </summary>
        public static IUIAutomationElement? GetFocusedElement()
        {
            return UIAutomationService.GetFocusedElement();
        }

        /// <summary>
        /// Find a text-capable element starting from the given element.
        /// Only searches ancestors (no descendant search).
        /// </summary>
        public static FocusResult? FindTextCapableElement(IUIAutomationElement element, bool editableOnly)
        {
            if (element == null) return null;

            try
            {
                // Check if current element is text-capable
                var isTextCapable = IsTextCapable(element);
                if (isTextCapable)
                {
                    var isEditable = IsElementEditable(element);
                    if (!editableOnly || isEditable)
                    {
                        return new FocusResult { Element = element, WasSearched = false };
                    }
                }

                // Search ancestors only (no descendant search)
                var sw = Stopwatch.StartNew();
                var walker = UIAutomationService.ControlViewWalker;
                var current = element;

                for (int i = 0; i < Constants.PARENT_CHAIN_MAX_DEPTH; i++)
                {
                    if (sw.ElapsedMilliseconds > Constants.PARENT_WALK_TIMEOUT_MS)
                        break;

                    try
                    {
                        var parent = walker.GetParentElement(current);
                        if (parent == null) break;

                        // Check if we've reached root
                        var automationId = parent.CurrentAutomationId;
                        var parentType = parent.CurrentControlType;
                        if (string.IsNullOrEmpty(automationId) && parentType == 0)
                            break;

                        if (IsTextCapable(parent))
                        {
                            var parentEditable = IsElementEditable(parent);
                            if (!editableOnly || parentEditable)
                            {
                                return new FocusResult { Element = parent, WasSearched = true };
                            }
                        }

                        current = parent;
                    }
                    catch (COMException)
                    {
                        break;
                    }
                }

                // If editableOnly is false, return original if it has ValuePattern
                if (!editableOnly && HasValuePattern(element))
                {
                    return new FocusResult { Element = element, WasSearched = false };
                }

                return null;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Check if element is text-capable.
        /// </summary>
        private static bool IsTextCapable(IUIAutomationElement element)
        {
            if (element == null) return false;

            try
            {
                var controlType = element.CurrentControlType;

                // Edit and Document are always text-capable
                if (controlType == Constants.UIA_EditControlTypeId ||
                    controlType == Constants.UIA_DocumentControlTypeId)
                {
                    return true;
                }

                // Check for TextPattern
                var textPattern = element.GetCurrentPattern(Constants.UIA_TextPatternId);
                return textPattern != null;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Check if element is editable.
        /// </summary>
        private static bool IsElementEditable(IUIAutomationElement element)
        {
            if (element == null) return false;

            try
            {
                var pattern = element.GetCurrentPattern(Constants.UIA_ValuePatternId);
                var valuePattern = pattern as IUIAutomationValuePattern;
                if (valuePattern != null)
                {
                    return valuePattern.CurrentIsReadOnly == 0;
                }

                var controlType = element.CurrentControlType;
                if (controlType == Constants.UIA_EditControlTypeId ||
                    controlType == Constants.UIA_DocumentControlTypeId)
                {
                    return element.CurrentIsEnabled != 0;
                }
            }
            catch
            {
            }

            return false;
        }

        /// <summary>
        /// Check if element has ValuePattern.
        /// </summary>
        private static bool HasValuePattern(IUIAutomationElement element)
        {
            if (element == null) return false;

            try
            {
                var pattern = element.GetCurrentPattern(Constants.UIA_ValuePatternId);
                return pattern != null;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Extract FocusedElement information.
        /// </summary>
        public static FocusedElement? GetElementInfo(IUIAutomationElement element)
        {
            if (element == null) return null;

            try
            {
                var (role, subrole) = RoleMapper.MapControlType(element);

                string? value = null;
                try
                {
                    var pattern = element.GetCurrentPattern(Constants.UIA_ValuePatternId);
                    var valuePattern = pattern as IUIAutomationValuePattern;
                    if (valuePattern != null)
                    {
                        value = valuePattern.CurrentValue;
                    }
                }
                catch { }

                // Suppress value for secure fields
                if (IsSecureField(element))
                {
                    value = null;
                }

                // Check focus state
                bool isFocused = true;
                try
                {
                    isFocused = element.CurrentHasKeyboardFocus != 0;
                }
                catch { }

                return new FocusedElement
                {
                    Role = role,
                    Subrole = subrole,
                    Title = element.CurrentName,
                    Value = value,
                    Description = element.CurrentHelpText,
                    IsEditable = IsElementEditable(element),
                    IsFocused = isFocused,
                    IsPlaceholder = IsPlaceholderShowing(element),
                    IsSecure = IsSecureField(element)
                };
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Check if element is a secure/password field.
        /// </summary>
        private static bool IsSecureField(IUIAutomationElement element)
        {
            if (element == null) return false;

            try
            {
                return element.CurrentIsPassword != 0;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Check if placeholder is showing.
        /// </summary>
        private static bool IsPlaceholderShowing(IUIAutomationElement element)
        {
            if (element == null) return false;

            try
            {
                var pattern = element.GetCurrentPattern(Constants.UIA_ValuePatternId);
                var valuePattern = pattern as IUIAutomationValuePattern;
                if (valuePattern != null)
                {
                    var value = valuePattern.CurrentValue;
                    if (string.IsNullOrEmpty(value))
                    {
                        return !string.IsNullOrEmpty(element.CurrentName);
                    }
                }
            }
            catch { }

            return false;
        }

        /// <summary>
        /// Get window information.
        /// </summary>
        public static WindowInfo? GetWindowInfo(IUIAutomationElement? element)
        {
            var windowElement = GetWindowElement(element);
            if (windowElement == null) return null;

            try
            {
                return new WindowInfo
                {
                    Title = windowElement.CurrentName,
                    Url = null
                };
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Get application information.
        /// </summary>
        public static (Application? app, string? processName) GetApplicationInfo(IUIAutomationElement? element)
        {
            if (element == null) return (null, null);

            try
            {
                // Get process ID directly from element (all elements have this)
                var processId = element.CurrentProcessId;
                var process = Process.GetProcessById(processId);

                var processName = process.ProcessName;
                string? bundleId = null;
                string? version = null;

                try
                {
                    bundleId = process.MainModule?.FileName ?? "";
                    version = process.MainModule?.FileVersionInfo.ProductVersion ?? "";
                }
                catch
                {
                    // Access denied to MainModule in some cases
                }

                var app = new Application
                {
                    Name = processName,
                    BundleIdentifier = bundleId ?? "",
                    Pid = processId,
                    Version = version ?? ""
                };

                return (app, processName);
            }
            catch
            {
                return (null, null);
            }
        }

        /// <summary>
        /// Get the window element containing the given element.
        /// </summary>
        private static IUIAutomationElement? GetWindowElement(IUIAutomationElement? element)
        {
            if (element == null) return null;

            try
            {
                // Check if current element is a window
                if (element.CurrentControlType == Constants.UIA_WindowControlTypeId)
                {
                    return element;
                }

                // Walk up to find window (use higher depth limit - windows can be far up the tree)
                var walker = UIAutomationService.ControlViewWalker;
                var current = element;

                for (int i = 0; i < Constants.WINDOW_SEARCH_MAX_DEPTH; i++)
                {
                    var parent = walker.GetParentElement(current);
                    if (parent == null) break;

                    if (parent.CurrentControlType == Constants.UIA_WindowControlTypeId)
                    {
                        return parent;
                    }

                    current = parent;
                }
            }
            catch
            {
            }

            return null;
        }
    }
}
