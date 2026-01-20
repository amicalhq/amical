using System;
using System.Collections.Generic;
using System.Windows.Automation;
using WindowsHelper.Models;

namespace WindowsHelper.Services
{
    /// <summary>
    /// Implements accessibility tree building using Windows UI Automation API.
    /// Note: GetAccessibilityContext has been moved to AccessibilityContextService.
    /// </summary>
    public class UIAutomationService
    {
        private readonly int maxDepth = 10;

        public AccessibilityElementNode? FetchAccessibilityTree(string? rootId)
        {
            try
            {
                LogToStderr("FetchAccessibilityTree called with UI Automation");

                AutomationElement rootElement;

                if (!string.IsNullOrEmpty(rootId))
                {
                    // Try to find element by automation ID
                    var condition = new PropertyCondition(AutomationElement.AutomationIdProperty, rootId);
                    rootElement = AutomationElement.RootElement.FindFirst(TreeScope.Descendants, condition);

                    if (rootElement == null)
                    {
                        LogToStderr($"Could not find element with ID: {rootId}");
                        return null;
                    }
                }
                else
                {
                    // Get the focused element as root
                    rootElement = AutomationElement.FocusedElement;
                    if (rootElement == null)
                    {
                        LogToStderr("No focused element found");
                        return null;
                    }
                }

                return BuildAccessibilityTree(rootElement, 0);
            }
            catch (Exception ex)
            {
                LogToStderr($"Error fetching accessibility tree: {ex.Message}");
                return null;
            }
        }

        private AccessibilityElementNode? BuildAccessibilityTree(AutomationElement element, int depth)
        {
            if (element == null || depth > maxDepth)
                return null;

            try
            {
                var node = new AccessibilityElementNode
                {
                    Id = element.Current.AutomationId,
                    Role = element.Current.ControlType.ProgrammaticName,
                    Name = element.Current.Name,
                    Value = GetElementValue(element),
                    Description = element.Current.HelpText,
                    IsEditable = IsElementEditable(element),
                    Children = new List<AccessibilityElementNode>()
                };

                // Get children
                var children = element.FindAll(TreeScope.Children, Condition.TrueCondition);
                foreach (AutomationElement child in children)
                {
                    var childNode = BuildAccessibilityTree(child, depth + 1);
                    if (childNode != null)
                    {
                        node.Children.Add(childNode);
                    }
                }

                return node;
            }
            catch (ElementNotAvailableException)
            {
                // Element became unavailable during traversal
                return null;
            }
            catch (Exception ex)
            {
                LogToStderr($"Error building tree node: {ex.Message}");
                return null;
            }
        }

        private string? GetElementValue(AutomationElement element)
        {
            try
            {
                // Try Value pattern first
                if (element.TryGetCurrentPattern(ValuePattern.Pattern, out object valuePattern))
                {
                    return (valuePattern as ValuePattern)?.Current.Value;
                }

                // Try Text pattern
                if (element.TryGetCurrentPattern(TextPattern.Pattern, out object textPattern))
                {
                    var tp = textPattern as TextPattern;
                    return tp?.DocumentRange?.GetText(-1);
                }

                // Try RangeValue pattern
                if (element.TryGetCurrentPattern(RangeValuePattern.Pattern, out object rangePattern))
                {
                    return (rangePattern as RangeValuePattern)?.Current.Value.ToString();
                }
            }
            catch
            {
                // Ignore pattern errors
            }

            return null;
        }

        private bool IsElementEditable(AutomationElement element)
        {
            try
            {
                // Check if element supports Value pattern and is not read-only
                if (element.TryGetCurrentPattern(ValuePattern.Pattern, out object valuePattern))
                {
                    var vp = valuePattern as ValuePattern;
                    return vp != null && !vp.Current.IsReadOnly;
                }

                // Check if it's an editable text control
                if (element.Current.ControlType == ControlType.Edit ||
                    element.Current.ControlType == ControlType.Document)
                {
                    return element.Current.IsEnabled;
                }
            }
            catch
            {
                // Ignore pattern errors
            }

            return false;
        }

        private void LogToStderr(string message)
        {
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            Console.Error.WriteLine($"[{timestamp}] [UIAutomationService] {message}");
            Console.Error.Flush();
        }
    }
}
