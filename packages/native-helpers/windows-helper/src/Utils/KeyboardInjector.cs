namespace WindowsHelper.Utils
{
    /// <summary>
    /// Injects a masked modifier release: [left-Ctrl down, modifier up, left-Ctrl up].
    /// The OS sees the Alt/Win release "in combination" with Ctrl, so it does not
    /// activate the menu bar (Alt) or Start menu (Win), while the modifier is still
    /// properly released (no stuck key). The events are built via KeyboardInput, so
    /// they carry the self-injected tag the helper's own hook skips. The left-Ctrl
    /// masking key (0xA2) is not extended, but the modifier being released may be
    /// (right-Alt, both Win keys) — its key-up carries KEYEVENTF_EXTENDEDKEY so the OS
    /// clears the real key instead of a non-extended left-side lookalike.
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

        // Right-Alt and both Win keys are extended keys (scancode prefixed with 0xE0);
        // left-Alt is not. A synthesized release of an extended modifier MUST set
        // KEYEVENTF_EXTENDEDKEY, or the OS emits a non-extended (left-side) scancode that
        // never clears the real key — e.g. a right-Alt release without the flag reads as
        // left-Alt and leaves right-Alt logically down, poisoning the next injected chord
        // (the dictation Ctrl+V lands as Ctrl+Alt+V and never pastes). Mirrors the
        // extended-key tagging in AccessibilityService.GetHeldModifiersToMask.
        private static bool IsExtendedModifier(int vk) =>
            vk == KeycodeConstants.VkRMenu
            || vk == KeycodeConstants.VkLWin
            || vk == KeycodeConstants.VkRWin;

        /// <summary>
        /// Inject [LCtrl down, modifierVk up, LCtrl up]. Returns false if SendInput did
        /// not dispatch every event.
        /// </summary>
        public static bool InjectMaskedRelease(int modifierVk)
        {
            var modifierUpFlags = KeyboardInput.KEYEVENTF_KEYUP;
            if (IsExtendedModifier(modifierVk))
            {
                modifierUpFlags |= KeyboardInput.KEYEVENTF_EXTENDEDKEY;
            }

            var inputs = new[]
            {
                KeyboardInput.KeyboardEvent(VK_LCONTROL),
                KeyboardInput.KeyboardEvent((ushort)modifierVk, modifierUpFlags),
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
