namespace WindowsHelper.Utils
{
    /// <summary>
    /// Injects a masked modifier release: [left-Ctrl down, modifier up, left-Ctrl up].
    /// The OS sees the Alt/Win release "in combination" with Ctrl, so it does not
    /// activate the menu bar (Alt) or Start menu (Win), while the modifier is still
    /// properly released (no stuck key). The events are built via KeyboardInput, so
    /// they carry the self-injected tag the helper's own hook skips. Uses left-Ctrl
    /// (0xA2) with no extended-key flag.
    /// </summary>
    internal static class KeyboardInjector
    {
        // Trade-off: left Ctrl is used only as a dummy chord key to keep Alt/Win
        // release from reaching Windows as a lone modifier. If the user is
        // physically holding left Ctrl and releases Alt/Win first, the trailing
        // synthetic left-Ctrl key-up can briefly clear Windows' logical Ctrl
        // state until the next physical Ctrl transition. There is no fully
        // reliable way to eliminate every case by choosing a dummy key from a
        // pre-injection state snapshot, because physical/synthetic key state can
        // change between the check and the SendInput batch. We bias toward this
        // simple fixed sequence because preventing Alt/Win focus steal is the
        // invariant.
        private const ushort VK_LCONTROL = (ushort)KeycodeConstants.VkLControl; // 0xA2 — left-Ctrl, the masking key

        /// <summary>
        /// Inject [LCtrl down, modifierVk up, LCtrl up]. Returns false if SendInput did
        /// not dispatch every event.
        /// </summary>
        public static bool InjectMaskedRelease(int modifierVk)
        {
            var inputs = new[]
            {
                KeyboardInput.KeyboardEvent(VK_LCONTROL),
                KeyboardInput.KeyboardEvent((ushort)modifierVk, KeyboardInput.KEYEVENTF_KEYUP),
                KeyboardInput.KeyboardEvent(VK_LCONTROL, KeyboardInput.KEYEVENTF_KEYUP),
            };

            var result = KeyboardInput.Send(inputs);
            // For this tiny valid batch, expected failure modes such as UIPI
            // (User Interface Privilege Isolation), a higher-integrity foreground
            // window, or a bad interop call should generally report 0 inserted
            // events. A partial prefix (1/3 or 2/3) is possible by SendInput's API
            // contract, but should be a tail-risk case. We intentionally do not
            // send a follow-up cleanup key-up here: that is another synthetic input
            // attempt after the input stream has already moved on, and it can race
            // or fail too. Treat partial sends as failure; the hook fails open by
            // passing through the real Alt/Win release. If this tail case becomes
            // important, record result.Sent counts and revisit.
            return result.Sent == (uint)inputs.Length;
        }
    }
}
