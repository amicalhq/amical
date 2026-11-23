//! The server's core keyboard mapping and modifier map (G2 §5.5, X path):
//! keysym → keycode for the injected chords, and the modifier bits that a
//! key grab needs.

use x11rb::connection::Connection;
use x11rb::errors::ReplyError;
use x11rb::protocol::xproto::ConnectionExt as _;

pub const XK_CONTROL_L: u32 = 0xffe3;
pub const XK_SHIFT_L: u32 = 0xffe1;
pub const XK_INSERT: u32 = 0xff63;
pub const XK_NUM_LOCK: u32 = 0xff7f;
pub const XK_LOWER_C: u32 = 0x63;
pub const XK_LOWER_V: u32 = 0x76;

/// X keycodes of a US pc105 evdev keymap (evdev code + 8), used when the
/// server mapping has no key for a keysym.
pub fn us_keycode(keysym: u32) -> Option<u8> {
    match keysym {
        XK_CONTROL_L => Some(37),
        XK_SHIFT_L => Some(50),
        XK_INSERT => Some(118),
        XK_LOWER_C => Some(54),
        XK_LOWER_V => Some(55),
        _ => None,
    }
}

/// The Lock row of the core modifier map (Shift, Lock, Control, Mod1 … Mod5).
const LOCK_ROW: usize = 1;

#[derive(Clone, Debug, Default)]
pub struct Keymap {
    min_keycode: u8,
    keysyms_per_keycode: usize,
    /// `keysyms_per_keycode` entries per keycode, from `min_keycode`.
    keysyms: Vec<u32>,
    /// Shift, Lock, Control, Mod1 … Mod5: the keycodes of each row.
    rows: [Vec<u8>; 8],
}

impl Keymap {
    pub fn fetch(conn: &impl Connection) -> Result<Self, ReplyError> {
        let setup = conn.setup();
        let (min, max) = (setup.min_keycode, setup.max_keycode);
        // Both requests go out before either reply is read.
        let mapping = conn.get_keyboard_mapping(min, max - min + 1)?;
        let modifiers = conn.get_modifier_mapping()?;
        let (mapping, modifiers) = (mapping.reply()?, modifiers.reply()?);
        let per_row = modifiers.keycodes.len() / 8;
        let mut rows: [Vec<u8>; 8] = Default::default();
        if per_row > 0 {
            for (row, keycodes) in rows.iter_mut().zip(modifiers.keycodes.chunks(per_row)) {
                *row = keycodes.iter().copied().filter(|&k| k != 0).collect();
            }
        }
        Ok(Self {
            min_keycode: min,
            keysyms_per_keycode: usize::from(mapping.keysyms_per_keycode),
            keysyms: mapping.keysyms,
            rows,
        })
    }

    fn keysyms_of(&self, keycode: u8) -> &[u32] {
        let per = self.keysyms_per_keycode;
        let Some(index) = keycode.checked_sub(self.min_keycode) else {
            return &[];
        };
        let start = usize::from(index) * per;
        self.keysyms.get(start..start + per).unwrap_or(&[])
    }

    fn keycodes(&self) -> impl Iterator<Item = u8> + '_ {
        let count = self.keysyms.len() / self.keysyms_per_keycode.max(1);
        (0..count).filter_map(|index| u8::try_from(usize::from(self.min_keycode) + index).ok())
    }

    /// The keycode that produces `keysym` with no modifier: first in the
    /// first group, then in the second group, then at any level. Toolkits
    /// match Ctrl shortcuts by the key's keysym in any group, so a key from
    /// another group still works as the shortcut.
    pub fn keycode_for(&self, keysym: u32) -> Option<u8> {
        let at = |column: usize| {
            self.keycodes()
                .find(|&keycode| self.keysyms_of(keycode).get(column) == Some(&keysym))
        };
        at(0).or_else(|| at(2)).or_else(|| {
            self.keycodes()
                .find(|&keycode| self.keysyms_of(keycode).contains(&keysym))
        })
    }

    /// The keycode for `keysym`, or the US keycode when the server mapping
    /// has none.
    pub fn resolve(&self, keysym: u32) -> Option<u8> {
        self.keycode_for(keysym).or_else(|| us_keycode(keysym))
    }

    /// The modifier bits that `keycode` sets.
    pub fn mask_of(&self, keycode: u8) -> u16 {
        self.rows
            .iter()
            .enumerate()
            .filter(|(_, row)| row.contains(&keycode))
            .fold(0, |mask, (row, _)| mask | 1 << row)
    }

    fn num_lock_rows(&self) -> u16 {
        self.rows
            .iter()
            .enumerate()
            .filter(|(_, row)| {
                row.iter()
                    .any(|&keycode| self.keysyms_of(keycode).contains(&XK_NUM_LOCK))
            })
            .fold(0, |mask, (row, _)| mask | 1 << row)
    }

    /// The masks to grab a combination with, so that it also works while
    /// CapsLock or NumLock is on.
    pub fn lock_variants(&self, mask: u16) -> Vec<u32> {
        let lock = 1 << LOCK_ROW;
        let num_lock = self.num_lock_rows();
        let mut masks = vec![mask, mask | lock, mask | num_lock, mask | lock | num_lock];
        masks.sort_unstable();
        masks.dedup();
        masks.into_iter().map(u32::from).collect()
    }

    /// Keycodes of the keys that change the modifier state while held:
    /// every row except Lock and the NumLock row.
    pub fn held_modifier_keycodes(&self) -> Vec<u8> {
        let skip = 1 << LOCK_ROW | self.num_lock_rows();
        let mut keycodes: Vec<u8> = self
            .rows
            .iter()
            .enumerate()
            .filter(|(row, _)| skip & (1 << row) == 0)
            .flat_map(|(_, row)| row.iter().copied())
            .collect();
        keycodes.sort_unstable();
        keycodes.dedup();
        keycodes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A small keymap: keycodes 37 (Control_L), 50 (Shift_L), 55 (v/V in
    /// group 1), 56 (Cyrillic in group 1, v in group 2), 77 (Num_Lock),
    /// 66 (Caps_Lock).
    fn keymap() -> Keymap {
        const NO: u32 = 0;
        let min = 37u8;
        let per = 4;
        let mut keysyms = vec![NO; (78 - usize::from(min)) * per];
        let mut set = |keycode: u8, syms: [u32; 4]| {
            let start = usize::from(keycode - min) * per;
            keysyms[start..start + per].copy_from_slice(&syms);
        };
        set(37, [XK_CONTROL_L, NO, NO, NO]);
        set(50, [XK_SHIFT_L, NO, NO, NO]);
        set(55, [XK_LOWER_V, 0x56, NO, NO]);
        set(56, [0x6cd, 0x6ed, XK_LOWER_V, 0x56]);
        set(66, [0xffe5, NO, NO, NO]);
        set(77, [XK_NUM_LOCK, NO, NO, NO]);
        let mut rows: [Vec<u8>; 8] = Default::default();
        rows[0] = vec![50];
        rows[1] = vec![66];
        rows[2] = vec![37];
        rows[4] = vec![77];
        Keymap {
            min_keycode: min,
            keysyms_per_keycode: per,
            keysyms,
            rows,
        }
    }

    #[test]
    fn keysyms_resolve_in_the_first_group_before_the_second() {
        let mut keymap = keymap();
        assert_eq!(keymap.resolve(XK_LOWER_V), Some(55));
        // Without a group 1 'v', the group 2 'v' key is next.
        let start = usize::from(55 - keymap.min_keycode) * keymap.keysyms_per_keycode;
        keymap.keysyms[start] = 0;
        assert_eq!(keymap.resolve(XK_LOWER_V), Some(56));
        // A keysym the server does not map falls back to the US keycode.
        assert_eq!(keymap.resolve(XK_INSERT), Some(118));
        assert_eq!(keymap.resolve(0x1234), None);
    }

    #[test]
    fn grab_masks_come_from_the_server_modifier_map() {
        let keymap = keymap();
        let (control, lock, num_lock): (u16, u32, u32) = (1 << 2, 1 << 1, 1 << 4);
        assert_eq!(keymap.mask_of(37), control);
        assert_eq!(keymap.mask_of(55), 0);
        let control = u32::from(control);
        assert_eq!(
            keymap.lock_variants(1 << 2),
            [
                control,
                control | lock,
                control | num_lock,
                control | lock | num_lock
            ]
        );
        // CapsLock and NumLock do not count as held modifiers.
        assert_eq!(keymap.held_modifier_keycodes(), [37, 50]);
    }
}
