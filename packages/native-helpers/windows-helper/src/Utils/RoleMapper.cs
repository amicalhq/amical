using System.Windows.Automation;

namespace WindowsHelper.Utils
{
    /// <summary>
    /// Maps Windows UI Automation ControlTypes to macOS AX-style role strings.
    /// Ensures cross-platform consistency with Swift helper output.
    /// </summary>
    public static class RoleMapper
    {
        /// <summary>
        /// Map a Windows ControlType to AX-style (role, subrole) strings.
        /// </summary>
        /// <param name="element">The automation element to map</param>
        /// <param name="processName">Optional process name for browser detection</param>
        /// <returns>Tuple of (role, subrole) where subrole may be null</returns>
        public static (string role, string? subrole) MapControlType(AutomationElement element, string? processName)
        {
            var controlType = element.Current.ControlType;

            // Check if this is a password field
            bool isPassword = false;
            try
            {
                var isPasswordValue = element.GetCurrentPropertyValue(AutomationElement.IsPasswordProperty);
                if (isPasswordValue != AutomationElement.NotSupported)
                {
                    isPassword = (bool)isPasswordValue;
                }
            }
            catch
            {
                // Ignore errors reading property
            }

            // Deterministic Document mapping: browser -> AXWebArea, else -> AXTextArea
            bool isBrowser = false;
            if (!string.IsNullOrEmpty(processName))
            {
                isBrowser = Constants.BrowserProcessNames.Contains(processName);
            }

            // Map ControlType to AX role/subrole
            if (controlType == ControlType.Edit)
            {
                if (isPassword)
                {
                    return ("AXTextField", "AXSecureTextField");
                }
                return ("AXTextField", null);
            }

            if (controlType == ControlType.Document)
            {
                if (isBrowser)
                {
                    return ("AXWebArea", null);
                }
                return ("AXTextArea", null);
            }

            if (controlType == ControlType.Text)
            {
                return ("AXStaticText", null);
            }

            if (controlType == ControlType.Button)
            {
                return ("AXButton", null);
            }

            if (controlType == ControlType.ComboBox)
            {
                return ("AXComboBox", null);
            }

            if (controlType == ControlType.List)
            {
                return ("AXList", null);
            }

            if (controlType == ControlType.ListItem)
            {
                return ("AXListItem", null);
            }

            if (controlType == ControlType.Menu)
            {
                return ("AXMenu", null);
            }

            if (controlType == ControlType.MenuItem)
            {
                return ("AXMenuItem", null);
            }

            if (controlType == ControlType.Pane)
            {
                return ("AXGroup", null);
            }

            if (controlType == ControlType.Window)
            {
                return ("AXWindow", null);
            }

            if (controlType == ControlType.CheckBox)
            {
                return ("AXCheckBox", null);
            }

            if (controlType == ControlType.RadioButton)
            {
                return ("AXRadioButton", null);
            }

            if (controlType == ControlType.Hyperlink)
            {
                return ("AXLink", null);
            }

            if (controlType == ControlType.Image)
            {
                return ("AXImage", null);
            }

            if (controlType == ControlType.Table)
            {
                return ("AXTable", null);
            }

            if (controlType == ControlType.Tree)
            {
                return ("AXOutline", null);
            }

            if (controlType == ControlType.TreeItem)
            {
                return ("AXOutlineRow", null);
            }

            if (controlType == ControlType.Tab)
            {
                return ("AXTabGroup", null);
            }

            if (controlType == ControlType.TabItem)
            {
                return ("AXTab", null);
            }

            if (controlType == ControlType.ToolBar)
            {
                return ("AXToolbar", null);
            }

            if (controlType == ControlType.Slider)
            {
                return ("AXSlider", null);
            }

            if (controlType == ControlType.ProgressBar)
            {
                return ("AXProgressIndicator", null);
            }

            if (controlType == ControlType.ScrollBar)
            {
                return ("AXScrollBar", null);
            }

            if (controlType == ControlType.Spinner)
            {
                return ("AXIncrementor", null);
            }

            if (controlType == ControlType.Group)
            {
                return ("AXGroup", null);
            }

            // Default: convert ProgrammaticName to AX format
            var name = controlType.ProgrammaticName;
            if (name.StartsWith("ControlType."))
            {
                name = name.Substring("ControlType.".Length);
            }
            return ("AX" + name, null);
        }
    }
}
