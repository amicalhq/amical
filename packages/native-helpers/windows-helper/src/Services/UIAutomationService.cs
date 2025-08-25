using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;
using System.Windows.Forms;
using WindowsHelper.Models;

namespace WindowsHelper.Services
{
    /// <summary>
    /// Implements accessibility functionality using Windows UI Automation API
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
        
        public AccessibilityContext GetAccessibilityContext(bool editableOnly)
        {
            var context = new AccessibilityContext();
            
            try
            {
                LogToStderr($"GetAccessibilityContext called with editableOnly: {editableOnly}");
                
                // Get focused element
                var focusedElement = AutomationElement.FocusedElement;
                if (focusedElement != null)
                {
                    // Populate focused element information
                    context.FocusedElement = new FocusedElement
                    {
                        Role = focusedElement.Current.ControlType.ProgrammaticName,
                        Title = focusedElement.Current.Name,
                        Value = GetElementValue(focusedElement),
                        Description = focusedElement.Current.HelpText,
                        IsEditable = IsElementEditable(focusedElement)
                    };
                    
                    context.FocusedElementRole = focusedElement.Current.ControlType.ProgrammaticName;
                    context.IsEditable = IsElementEditable(focusedElement);
                    
                    // Get text selection if available
                    if (focusedElement.TryGetCurrentPattern(TextPattern.Pattern, out object textPattern))
                    {
                        var tp = textPattern as TextPattern;
                        if (tp != null)
                        {
                            var selection = tp.GetSelection();
                            if (selection.Length > 0)
                            {
                                var range = selection[0];
                                context.TextSelection = new TextSelection
                                {
                                    SelectedText = range.GetText(-1),
                                    IsEditable = context.IsEditable
                                };
                            }
                        }
                    }
                }
                
                // Get window information
                var window = GetWindowElement(focusedElement);
                if (window != null)
                {
                    context.WindowInfo = new WindowInfo
                    {
                        Title = window.Current.Name
                    };
                    context.WindowTitle = window.Current.Name;
                    
                    // Get application info
                    try
                    {
                        var processId = window.Current.ProcessId;
                        var process = System.Diagnostics.Process.GetProcessById(processId);
                        
                        context.Application = new Models.Application
                        {
                            Name = process.ProcessName,
                            BundleIdentifier = process.MainModule?.FileName ?? "",
                            Version = process.MainModule?.FileVersionInfo.ProductVersion ?? ""
                        };
                        context.ApplicationName = process.ProcessName;
                        
                        // Detect if it's a web browser
                        var browserNames = new[] { "chrome", "firefox", "edge", "msedge", "brave", "opera" };
                        context.IsWebContent = Array.Exists(browserNames, 
                            name => process.ProcessName.ToLower().Contains(name));
                            
                        // For browsers, try to get URL
                        if (context.IsWebContent)
                        {
                            var urlBar = FindUrlBar(window);
                            if (urlBar != null)
                            {
                                context.WindowInfo.Url = GetElementValue(urlBar);
                            }
                        }
                    }
                    catch
                    {
                        context.ApplicationName = "Unknown";
                    }
                }
                
                context.Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;
                
                LogToStderr($"Accessibility context retrieved: App={context.ApplicationName}, Window={context.WindowTitle}");
            }
            catch (Exception ex)
            {
                LogToStderr($"Error getting accessibility context: {ex.Message}");
            }
            
            return context;
        }
        
        private AutomationElement? GetWindowElement(AutomationElement? element)
        {
            if (element == null) return null;
            
            var current = element;
            while (current != null)
            {
                if (current.Current.ControlType == ControlType.Window)
                    return current;
                    
                try
                {
                    var parent = TreeWalker.ControlViewWalker.GetParent(current);
                    if (parent == null || parent.Equals(AutomationElement.RootElement))
                        break;
                    current = parent;
                }
                catch
                {
                    break;
                }
            }
            
            return null;
        }
        
        private AutomationElement? FindUrlBar(AutomationElement window)
        {
            try
            {
                // Common patterns for finding URL bars in browsers
                var conditions = new Condition[]
                {
                    new PropertyCondition(AutomationElement.AutomationIdProperty, "addressEditBox"),
                    new PropertyCondition(AutomationElement.AutomationIdProperty, "urlbar"),
                    new PropertyCondition(AutomationElement.AutomationIdProperty, "omnibox"),
                    new AndCondition(
                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
                        new PropertyCondition(AutomationElement.IsKeyboardFocusableProperty, true)
                    )
                };
                
                foreach (var condition in conditions)
                {
                    var element = window.FindFirst(TreeScope.Descendants, condition);
                    if (element != null)
                        return element;
                }
            }
            catch
            {
                // Ignore errors in URL detection
            }
            
            return null;
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
                    return (textPattern as TextPattern)?.DocumentRange.GetText(-1);
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