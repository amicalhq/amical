//! Key state for the X11 backend (contract §3, §4.3): the held keys and the
//! events for the desktop, the Draft-Enter mask, and the key that started
//! the active grab. This module makes no X calls: the X server consumes the
//! keys through the passive grabs (see `keys`).
//!
//! Key codes here are evdev codes (X keycode − 8).

use std::collections::BTreeSet;

/// The keys that the desktop treats as modifiers: left/right Ctrl, Shift,
/// Alt and Super.
pub const MODIFIER_CODES: [u16; 8] = [29, 97, 42, 54, 56, 100, 125, 126];
/// KEY_ENTER and KEY_KPENTER.
pub const ENTER_CODES: [u16; 2] = [28, 96];

pub fn is_modifier(code: u16) -> bool {
    MODIFIER_CODES.contains(&code)
}

pub fn is_enter(code: u16) -> bool {
    ENTER_CODES.contains(&code)
}

/// Where a raw key event came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    /// A keyboard device.
    Device,
    /// XTest from another client.
    Injected,
    /// XTest from this helper (the paste or copy chord).
    Own,
}

/// A keyDown or keyUp for the desktop, with the modifier state after the
/// event.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KeyEvent {
    pub code: u16,
    pub down: bool,
    pub alt: bool,
    pub ctrl: bool,
    pub shift: bool,
    pub meta: bool,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct RawOutcome {
    pub event: Option<KeyEvent>,
    /// The Draft-Enter mask disarmed itself: its grabs must go.
    pub draft_disarmed: bool,
}

#[derive(Debug, Default)]
pub struct Gate {
    /// Keys held, from devices and from allowed injection.
    pressed: BTreeSet<u16>,
    chords: Vec<BTreeSet<u16>>,
    allow_injected: bool,
    draft_armed: bool,
    draft_consuming: bool,
    /// The key whose press started the active grab, while it is held.
    consumed: Option<u16>,
}

impl Gate {
    pub fn set_chords(&mut self, chords: Vec<BTreeSet<u16>>) {
        self.chords = chords;
    }

    pub fn chords(&self) -> &[BTreeSet<u16>] {
        &self.chords
    }

    pub fn set_allow_injected(&mut self, allow: bool) {
        self.allow_injected = allow;
    }

    /// Arms or disarms the Draft-Enter mask. Disarming does not end a press
    /// that is being consumed: it stays consumed through its key-up.
    pub fn set_draft_armed(&mut self, armed: bool) {
        self.draft_armed = armed;
    }

    pub fn draft_armed(&self) -> bool {
        self.draft_armed
    }

    /// True while a key whose press was consumed is held. Its grab gets
    /// every key event until it is released.
    pub fn consumed_key_held(&self) -> bool {
        self.consumed.is_some()
    }

    /// Updates the held keys from a raw event and gives the event for the
    /// desktop. A modifier is reported only when its state changes, as on
    /// macOS and Windows; every press and release of another key is
    /// reported.
    pub fn raw(&mut self, code: u16, down: bool, source: Source) -> RawOutcome {
        let tracked = match source {
            Source::Device => true,
            Source::Injected => self.allow_injected,
            Source::Own => false,
        };
        if !down && self.consumed == Some(code) {
            self.consumed = None;
        }
        if !tracked {
            return RawOutcome::default();
        }

        let mut outcome = RawOutcome::default();
        if down {
            let was_down = !self.pressed.insert(code);
            if is_enter(code) && (self.draft_armed || self.draft_consuming) {
                self.draft_consuming = true;
            }
            if is_modifier(code) && was_down {
                return outcome;
            }
        } else {
            let was_down = self.pressed.remove(&code);
            if is_modifier(code) && !was_down {
                return outcome;
            }
            if is_enter(code) && self.draft_consuming {
                // Self-disarm on the key-up: a missed disarm from the
                // desktop costs at most one Enter press.
                self.draft_consuming = false;
                self.draft_armed = false;
                outcome.draft_disarmed = true;
            }
        }
        outcome.event = Some(self.event(code, down));
        outcome
    }

    /// Records a key press that a grab took from the focused app. Returns
    /// true when the press started the grab, which lasts until that key is
    /// released; later presses arrive through the same grab.
    pub fn grabbed(&mut self, code: u16) -> bool {
        if is_enter(code) && self.draft_armed {
            self.draft_consuming = true;
        }
        if self.consumed.is_some() {
            return false;
        }
        self.consumed = Some(code);
        true
    }

    fn event(&self, code: u16, down: bool) -> KeyEvent {
        let held = |codes: [u16; 2]| codes.iter().any(|code| self.pressed.contains(code));
        KeyEvent {
            code,
            down,
            alt: held([56, 100]),
            ctrl: held([29, 97]),
            shift: held([42, 54]),
            meta: held([125, 126]),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LCTRL: u16 = 29;
    const SPACE: u16 = 57;
    const A: u16 = 30;
    const ENTER: u16 = 28;

    fn press(gate: &mut Gate, codes: &[u16], source: Source) {
        for &code in codes {
            gate.raw(code, true, source);
        }
    }

    #[test]
    fn injected_keys_are_reported_only_when_allowed() {
        let mut gate = Gate::default();
        assert_eq!(gate.raw(A, true, Source::Injected).event, None);
        gate.set_allow_injected(true);
        assert!(gate.raw(A, true, Source::Injected).event.is_some());
        // The helper's own injection never is.
        assert_eq!(gate.raw(SPACE, true, Source::Own).event, None);
    }

    #[test]
    fn a_grab_lasts_until_the_key_that_started_it_is_released() {
        let mut gate = Gate::default();
        press(&mut gate, &[LCTRL, SPACE], Source::Device);
        assert!(gate.grabbed(SPACE));
        // A key pressed during the grab arrives through it.
        assert!(!gate.grabbed(A));
        gate.raw(LCTRL, false, Source::Device);
        assert!(gate.consumed_key_held());
        gate.raw(SPACE, false, Source::Device);
        assert!(!gate.consumed_key_held());

        // A press that is not tracked (own injection) ends its grab too.
        gate.raw(SPACE, true, Source::Own);
        assert!(gate.grabbed(SPACE));
        gate.raw(SPACE, false, Source::Own);
        assert!(!gate.consumed_key_held());
    }

    #[test]
    fn the_draft_enter_mask_disarms_itself_after_one_press() {
        let mut gate = Gate::default();
        gate.set_draft_armed(true);
        gate.raw(ENTER, true, Source::Device);
        gate.grabbed(ENTER);
        let up = gate.raw(ENTER, false, Source::Device);
        assert!(up.draft_disarmed);
        assert!(!gate.draft_armed());

        gate.raw(ENTER, true, Source::Device);
        assert!(!gate.raw(ENTER, false, Source::Device).draft_disarmed);
    }

    #[test]
    fn disarming_does_not_cut_short_a_consumed_enter_press() {
        let mut gate = Gate::default();
        gate.set_draft_armed(true);
        gate.raw(ENTER, true, Source::Device);
        gate.grabbed(ENTER);
        gate.set_draft_armed(false);
        assert!(gate.raw(ENTER, false, Source::Device).draft_disarmed);
    }

    #[test]
    fn modifiers_report_transitions_and_flags_follow_the_held_keys() {
        let mut gate = Gate::default();
        let down = gate.raw(LCTRL, true, Source::Device).event.unwrap();
        assert!(down.down && down.ctrl && !down.alt);
        // A second press of a held modifier (another keyboard) is not news.
        assert_eq!(gate.raw(LCTRL, true, Source::Device).event, None);
        // A held regular key reports each press, like auto-repeat.
        assert!(gate.raw(A, true, Source::Device).event.unwrap().ctrl);
        assert!(gate.raw(A, true, Source::Device).event.is_some());
        let up = gate.raw(LCTRL, false, Source::Device).event.unwrap();
        assert!(!up.down && !up.ctrl);
        // A second release of a modifier is not news either; a regular key's
        // release always is.
        assert_eq!(gate.raw(LCTRL, false, Source::Device).event, None);
        assert!(gate.raw(SPACE, false, Source::Device).event.is_some());
        // Filtered keys produce no events.
        assert_eq!(gate.raw(A, true, Source::Injected).event, None);
    }
}
