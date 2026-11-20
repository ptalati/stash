//! Non-secret preferences, plain JSON at <app data>/settings.json.

use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};

pub const DEFAULT_ACCEL: &str = "ctrl+shift+Space";
pub const DEFAULT_LABEL: &str = "Ctrl+Shift+Space";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Accelerator in the global-shortcut plugin's format, e.g. "ctrl+alt+KeyV".
    pub hotkey: String,
    /// How it is shown to people, e.g. "Ctrl+Alt+V".
    pub hotkey_label: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self { hotkey: DEFAULT_ACCEL.into(), hotkey_label: DEFAULT_LABEL.into() }
    }
}

pub struct SettingsFile(PathBuf);

impl SettingsFile {
    pub fn new(dir: &Path) -> Self {
        Self(dir.join("settings.json"))
    }

    pub fn load(&self) -> Settings {
        fs::read_to_string(&self.0)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, s: &Settings) -> Result<(), String> {
        let text = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
        fs::write(&self.0, text).map_err(|e| e.to_string())
    }
}
