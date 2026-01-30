using System;
using Interop.UIAutomationClient;

namespace WindowsHelper.Utils
{
    /// <summary>
    /// Maps Windows UI Automation ControlTypes to role strings.
    /// </summary>
    public static class RoleMapper
    {
        /// <summary>
        /// Map a Windows ControlType to (role, subrole) strings.
        /// </summary>
        public static (string role, string? subrole) MapControlType(IUIAutomationElement element)
        {
            if (element == null)
                return ("Unknown", null);

            try
            {
                var controlType = element.CurrentControlType;
                bool isPassword = false;

                try
                {
                    isPassword = element.CurrentIsPassword != 0;
                }
                catch { }

                // Map only the control types we use in logic; others return "Unknown"
                return controlType switch
                {
                    Constants.UIA_EditControlTypeId => isPassword ? ("TextField", "SecureTextField") : ("TextField", null),
                    Constants.UIA_DocumentControlTypeId => ("TextArea", null),
                    Constants.UIA_GroupControlTypeId => ("Group", null),
                    Constants.UIA_WindowControlTypeId => ("Window", null),
                    _ => ("Unknown", null)
                };
            }
            catch
            {
                return ("Unknown", null);
            }
        }
    }
}
