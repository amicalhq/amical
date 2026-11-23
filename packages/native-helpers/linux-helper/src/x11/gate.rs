//! The shortcut consume gate and the Draft-Enter mask (contract §4.2, §4.3),
//! driven by raw key events. This module makes no X calls: the key thread
//! applies its decisions with grabs and AllowEvents.
//!
//! Key codes here are evdev codes (X keycode − 8).

use std::collections::{BTreeSet, HashSet};

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    /// Keep the key from the focused app.
    Consume,
    /// Give the key to the focused app.
    Replay,
}

#[derive(Debug, Default)]
pub struct Gate {
    /// Keys held, from devices and from allowed injection.
    pressed: BTreeSet<u16>,
    chords: Vec<BTreeSet<u16>>,
    allow_injected: bool,
    draft_armed: bool,
    draft_consuming: bool,
    /// Keys whose last press was not tracked (this helper's own injection or
    /// filtered injection). A grab activation for such a press replays.
    untracked: HashSet<u16>,
    /// The key whose press activated a consuming grab, while it is held.
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
            if down {
                self.untracked.insert(code);
            } else {
                self.untracked.remove(&code);
            }
            return RawOutcome::default();
        }
        self.untracked.remove(&code);

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

    /// Decides a grab activation for a key press. A chord key is consumed
    /// only when its chord is exactly held, counting this key; Enter is
    /// consumed while the Draft-Enter mask is armed or a press is in flight.
    pub fn decide(&mut self, code: u16) -> Decision {
        if self.untracked.contains(&code) {
            return Decision::Replay;
        }
        let consume = if is_enter(code) && (self.draft_armed || self.draft_consuming) {
            self.draft_consuming = true;
            true
        } else {
            let mut active = self.pressed.clone();
            active.insert(code);
            self.chords
                .iter()
                .any(|chord| !chord.is_empty() && *chord == active)
        };
        if !consume {
            return Decision::Replay;
        }
        // The grab ends when the key that started it is released.
        self.consumed.get_or_insert(code);
        Decision::Consume
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
    const RCTRL: u16 = 97;
    const LALT: u16 = 56;
    const LSHIFT: u16 = 42;
    const SPACE: u16 = 57;
    const A: u16 = 30;
    const ENTER: u16 = 28;

    fn gate_with(chords: &[&[u16]]) -> Gate {
        let mut gate = Gate::default();
        gate.set_chords(
            chords
                .iter()
                .map(|chord| chord.iter().copied().collect())
                .collect(),
        );
        gate
    }

    fn press(gate: &mut Gate, codes: &[u16], source: Source) {
        for &code in codes {
            gate.raw(code, true, source);
        }
    }

    fn release_all(gate: &mut Gate, codes: &[u16]) {
        for &code in codes {
            gate.raw(code, false, Source::Device);
        }
    }

    #[test]
    fn a_chord_key_is_consumed_only_when_the_chord_is_exactly_held() {
        // held before the key, the key, the expected decision
        #[rustfmt::skip]
        let rows: [(&[u16], u16, Decision); 6] = [
            (&[LCTRL, LALT], SPACE, Decision::Consume),
            // Partial chord: Ctrl+Space stays typeable.
            (&[LCTRL], SPACE, Decision::Replay),
            // Right Ctrl is a different key from the chord's left Ctrl.
            (&[RCTRL, LALT], SPACE, Decision::Replay),
            // An extra modifier or regular key held.
            (&[LCTRL, LALT, LSHIFT], SPACE, Decision::Replay),
            (&[LCTRL, LALT, A], SPACE, Decision::Replay),
            // The key itself already counts as held (raw event first).
            (&[LCTRL, LALT, SPACE], SPACE, Decision::Consume),
        ];
        for (held, key, expected) in rows {
            let mut gate = gate_with(&[&[LCTRL, LALT, SPACE]]);
            press(&mut gate, held, Source::Device);
            assert_eq!(gate.decide(key), expected, "held {held:?}");
        }
    }

    #[test]
    fn injected_keys_drive_the_gate_only_when_allowed() {
        let mut gate = gate_with(&[&[LCTRL, LALT, SPACE]]);
        press(&mut gate, &[LCTRL, LALT, SPACE], Source::Injected);
        assert_eq!(gate.decide(SPACE), Decision::Replay);
        release_all(&mut gate, &[SPACE, LALT, LCTRL]);

        gate.set_allow_injected(true);
        press(&mut gate, &[LCTRL, LALT, SPACE], Source::Injected);
        assert_eq!(gate.decide(SPACE), Decision::Consume);
        release_all(&mut gate, &[SPACE, LALT, LCTRL]);

        // The helper's own injection never drives it.
        press(&mut gate, &[LCTRL, LALT, SPACE], Source::Own);
        assert_eq!(gate.decide(SPACE), Decision::Replay);
    }

    #[test]
    fn a_consumed_press_is_held_until_its_key_up() {
        let mut gate = gate_with(&[&[LCTRL, SPACE]]);
        press(&mut gate, &[LCTRL, SPACE], Source::Device);
        assert_eq!(gate.decide(SPACE), Decision::Consume);
        gate.raw(LCTRL, false, Source::Device);
        assert!(gate.consumed_key_held());
        gate.raw(SPACE, false, Source::Device);
        assert!(!gate.consumed_key_held());
    }

    #[test]
    fn the_draft_enter_mask_swallows_one_press_and_disarms_itself() {
        let mut gate = Gate::default();
        gate.set_draft_armed(true);
        gate.raw(ENTER, true, Source::Device);
        assert_eq!(gate.decide(ENTER), Decision::Consume);
        // Auto-repeat of the same press.
        assert_eq!(gate.decide(ENTER), Decision::Consume);
        let up = gate.raw(ENTER, false, Source::Device);
        assert!(up.draft_disarmed);
        assert!(!gate.draft_armed());

        gate.raw(ENTER, true, Source::Device);
        assert_eq!(gate.decide(ENTER), Decision::Replay);
        assert!(!gate.raw(ENTER, false, Source::Device).draft_disarmed);
    }

    #[test]
    fn disarming_does_not_cut_short_a_consumed_enter_press() {
        let mut gate = Gate::default();
        gate.set_draft_armed(true);
        gate.raw(ENTER, true, Source::Device);
        assert_eq!(gate.decide(ENTER), Decision::Consume);
        gate.set_draft_armed(false);
        assert_eq!(gate.decide(ENTER), Decision::Consume);
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
