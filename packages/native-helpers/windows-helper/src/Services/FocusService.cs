using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
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
            return PlaceholderHelpers.IsPlaceholderShowing(element);
        }

        /// <summary>
        /// Get window information.
        /// </summary>
        public static WindowInfo? GetWindowInfo(IntPtr windowHandle)
        {
            if (windowHandle == IntPtr.Zero) return null;

            var title = GetWindowTitle(windowHandle);
            if (string.IsNullOrEmpty(title))
            {
                LogToStderr("Resolved window has an empty caption");
                return null;
            }

            return new WindowInfo
            {
                Title = title,
                Url = null
            };
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
                string? version = null;

                try
                {
                    // ProductVersion still needs MainModule. The bundle id on
                    // Windows is the process name (no path, no .exe) so it is a
                    // stable, comparable key for app matching.
                    version = process.MainModule?.FileVersionInfo.ProductVersion ?? "";
                }
                catch
                {
                    // Access denied to MainModule in some cases
                }

                var app = new Application
                {
                    Name = processName,
                    BundleIdentifier = processName,
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
        /// Resolve the top-level native window handle for an element. The handle
        /// from <see cref="ResolveWindowHandle"/> may belong to a child window
        /// (e.g. Chromium's render-widget "Chrome Legacy Window"), so climb to the
        /// root. Returns IntPtr.Zero when no window can be resolved. Shared by the
        /// window title and the browser-URL omnibox lookup so both agree on the
        /// window.
        /// </summary>
        public static IntPtr GetTopLevelWindowHandle(IUIAutomationElement? element)
        {
            var hwnd = ResolveWindowHandle(element);
            if (hwnd == IntPtr.Zero) return IntPtr.Zero;

            var root = GetAncestor(hwnd, GA_ROOT);
            return root != IntPtr.Zero ? root : hwnd;
        }

        /// <summary>
        /// Resolve the native window handle for an element: its own handle, then
        /// the nearest ancestor that has one, then the foreground window. We key
        /// off the HWND rather than a UIA Window ancestor because UIA window
        /// navigation is unreliable for windows that expose accessibility via the
        /// legacy bridge — notably our own Electron windows, where the walk finds
        /// no Window node and the window goes unresolved.
        /// </summary>
        private static IntPtr ResolveWindowHandle(IUIAutomationElement? element)
        {
            if (element == null)
            {
                LogToStderr("element is null");
            }
            else
            {
                var handle = GetNativeWindowHandle(element);
                if (handle != IntPtr.Zero)
                {
                    LogToStderr("Resolved window handle from focused element");
                    return handle;
                }

                try
                {
                    var walker = UIAutomationService.ControlViewWalker;
                    var current = element;

                    for (int i = 0; i < Constants.WINDOW_SEARCH_MAX_DEPTH; i++)
                    {
                        var parent = walker.GetParentElement(current);
                        if (parent == null)
                        {
                            LogToStderr($"Parent is null at depth {i}; no native window handle in ancestor chain");
                            break;
                        }

                        handle = GetNativeWindowHandle(parent);
                        if (handle != IntPtr.Zero)
                        {
                            LogToStderr($"Resolved window handle from ancestor at depth {i}");
                            return handle;
                        }

                        current = parent;
                    }
                }
                catch (Exception ex)
                {
                    LogToStderr($"Exception walking ancestor chain: {ex.Message}");
                }
            }

            // Last resort: the foreground window. The accessibility context is
            // captured for the foreground app, so this is the right window when
            // UIA navigation yields no handle.
            LogToStderr("No native window handle from UIA tree; falling back to GetForegroundWindow");
            return GetForegroundWindow();
        }

        private static IntPtr GetNativeWindowHandle(IUIAutomationElement element)
        {
            try
            {
                // The interop exposes the handle as an int; the cast also accepts
                // an IntPtr-typed property, so it is robust to interop changes.
                return (IntPtr)element.CurrentNativeWindowHandle;
            }
            catch
            {
                return IntPtr.Zero;
            }
        }

        private static string? GetWindowTitle(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return null;

            int length = GetWindowTextLength(hwnd);
            if (length <= 0) return null;

            var buffer = new StringBuilder(length + 1);
            GetWindowText(hwnd, buffer, buffer.Capacity);
            return buffer.ToString();
        }

        private static void LogToStderr(string message)
        {
            HelperLogger.LogToStderr($"[FocusService] {message}");
        }

        private const uint GA_ROOT = 2;

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        private static extern int GetWindowTextLength(IntPtr hWnd);
    }
}
