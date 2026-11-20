//! Putting text into the app the user was in before the palette opened.
//!
//! Flow for "paste": remember the user's clipboard, put the snippet on it
//! (excluded from Win+V history and cloud sync when sensitive), give focus back
//! to the previous window, send Ctrl+V, then restore the old clipboard.
//! Flow for "copy": leave the snippet on the clipboard; a sensitive one is
//! cleared again after 30 s if it is still there.

use arboard::Clipboard;
use std::{thread, time::Duration};

#[cfg(windows)]
use arboard::SetExtWindows;

const RESTORE_AFTER_PASTE: Duration = Duration::from_millis(600);
const CLEAR_SENSITIVE_COPY: Duration = Duration::from_secs(30);

fn set_text(cb: &mut Clipboard, text: &str, sensitive: bool) -> Result<(), String> {
    #[cfg(windows)]
    if sensitive {
        return cb
            .set()
            .exclude_from_history()
            .exclude_from_cloud()
            .text(text.to_owned())
            .map_err(|e| e.to_string());
    }
    let _ = sensitive;
    cb.set_text(text.to_owned()).map_err(|e| e.to_string())
}

pub fn copy(text: String, sensitive: bool) -> Result<(), String> {
    let mut cb = Clipboard::new().map_err(|e| e.to_string())?;
    set_text(&mut cb, &text, sensitive)?;
    if sensitive {
        thread::spawn(move || {
            thread::sleep(CLEAR_SENSITIVE_COPY);
            if let Ok(mut cb) = Clipboard::new() {
                if cb.get_text().ok().as_deref() == Some(text.as_str()) {
                    let _ = cb.clear();
                }
            }
        });
    }
    Ok(())
}

pub fn paste(text: String, sensitive: bool, target: isize) -> Result<(), String> {
    let mut cb = Clipboard::new().map_err(|e| e.to_string())?;
    let previous = cb.get_text().ok();
    set_text(&mut cb, &text, sensitive)?;
    drop(cb);

    platform::focus(target);
    thread::sleep(Duration::from_millis(80));
    platform::send_ctrl_v();

    thread::spawn(move || {
        thread::sleep(RESTORE_AFTER_PASTE);
        if let Ok(mut cb) = Clipboard::new() {
            // Only put the old value back if nobody changed the clipboard meanwhile.
            if cb.get_text().ok().as_deref() == Some(text.as_str()) {
                match previous {
                    Some(p) => { let _ = cb.set_text(p); }
                    None => { let _ = cb.clear(); }
                }
            }
        }
    });
    Ok(())
}

#[cfg(windows)]
pub mod platform {
    use std::mem::size_of;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};

    const VK_V: u16 = 0x56;

    pub fn foreground() -> isize {
        unsafe { GetForegroundWindow() as isize }
    }

    pub fn focus(hwnd: isize) {
        if hwnd != 0 {
            unsafe { SetForegroundWindow(hwnd as _) };
        }
    }

    fn key(vk: u16, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    pub fn send_ctrl_v() {
        let inputs = [key(VK_CONTROL, false), key(VK_V, false), key(VK_V, true), key(VK_CONTROL, true)];
        unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), size_of::<INPUT>() as i32) };
    }
}

// TODO(mac/linux): CGEvent / xdotool equivalents.
#[cfg(not(windows))]
pub mod platform {
    pub fn foreground() -> isize { 0 }
    pub fn focus(_: isize) {}
    pub fn send_ctrl_v() {}
}
