import Foundation

let fnKeyCode = 0x3F
let leftCommandKeyCode = 55
let rightCommandKeyCode = 54
let leftControlKeyCode = 59
let rightControlKeyCode = 62
let leftOptionKeyCode = 58
let rightOptionKeyCode = 61
let leftShiftKeyCode = 56
let rightShiftKeyCode = 60

let modifierKeyCodes: [Int] = [
    fnKeyCode,
    leftCommandKeyCode,
    rightCommandKeyCode,
    leftControlKeyCode,
    rightControlKeyCode,
    leftOptionKeyCode,
    rightOptionKeyCode,
    leftShiftKeyCode,
    rightShiftKeyCode,
]

let modifierKeyCodeSet = Set(modifierKeyCodes)
