import CoreGraphics

/// Map modifier key codes to their corresponding CGEventFlags.
func modifierFlag(for keyCode: Int) -> CGEventFlags? {
    switch keyCode {
    case leftCommandKeyCode, rightCommandKeyCode:
        return .maskCommand
    case leftControlKeyCode, rightControlKeyCode:
        return .maskControl
    case leftOptionKeyCode, rightOptionKeyCode:
        return .maskAlternate
    case leftShiftKeyCode, rightShiftKeyCode:
        return .maskShift
    case fnKeyCode:
        return .maskSecondaryFn
    default:
        return nil
    }
}
