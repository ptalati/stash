//! Snippet storage: one JSON document, encrypted at rest with Windows DPAPI
//! (CurrentUser scope), at <app data>/snippets.dat.

use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: String,
    pub name: String,
    pub body: String,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub group: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub sensitive: bool,
}

#[derive(Serialize, Deserialize)]
struct Doc {
    version: u32,
    snippets: Vec<Snippet>,
}

pub struct Store {
    path: PathBuf,
}

impl Store {
    pub fn new(dir: &Path) -> Self {
        let _ = fs::create_dir_all(dir);
        Self { path: dir.join("snippets.dat") }
    }

    pub fn load(&self) -> Result<Vec<Snippet>, String> {
        if !self.path.exists() {
            let seed = seed();
            self.save(&seed)?;
            return Ok(seed);
        }
        let raw = fs::read(&self.path).map_err(|e| e.to_string())?;
        let plain = crypto::unprotect(&raw)?;
        let doc: Doc = serde_json::from_slice(&plain).map_err(|e| e.to_string())?;
        Ok(doc.snippets)
    }

    pub fn save(&self, snippets: &[Snippet]) -> Result<(), String> {
        let doc = Doc { version: 1, snippets: snippets.to_vec() };
        let plain = serde_json::to_vec(&doc).map_err(|e| e.to_string())?;
        let sealed = crypto::protect(&plain)?;
        let tmp = self.path.with_extension("tmp");
        fs::write(&tmp, sealed).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
    }

    /// Stopgap until the manager window exists: replace all snippets with the
    /// contents of a plain JSON file (array of snippets), then delete that file
    /// so the plaintext doesn't linger.
    pub fn import_plain(&self, file: &Path) -> Result<usize, String> {
        let text = fs::read_to_string(file).map_err(|e| format!("{}: {e}", file.display()))?;
        let snippets: Vec<Snippet> = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        self.save(&snippets)?;
        let _ = fs::remove_file(file);
        Ok(snippets.len())
    }
}

fn s(id: &str, name: &str, body: &str, kw: &[&str], group: &str, pinned: bool, sensitive: bool) -> Snippet {
    Snippet {
        id: id.into(),
        name: name.into(),
        body: body.into(),
        keywords: kw.iter().map(|k| k.to_string()).collect(),
        group: group.into(),
        pinned,
        sensitive,
    }
}

fn seed() -> Vec<Snippet> {
    vec![
        s("gstin", "GSTIN", "[YOUR GSTIN]", &["gst", "tax"], "Tax IDs", true, false),
        s("bank", "Bank details for invoices",
          "Account name: [YOUR BUSINESS NAME]\nA/c no: [ACCOUNT NUMBER]\nIFSC: [IFSC]\nBank: [BANK, BRANCH]",
          &["bank", "ifsc", "account", "neft"], "Invoicing", true, true),
        s("cover", "Invoice cover email",
          "Hi,\n\nPlease find attached the invoice for this month. Bank details are below.\n\nThanks",
          &["invoice", "email"], "Replies", true, false),
        s("upi", "UPI ID", "[YOUR UPI ID]", &["upi", "pay"], "Invoicing", true, false),
        s("address", "Office address", "[YOUR BILLING ADDRESS]", &["address"], "Invoicing", false, false),
    ]
}

#[cfg(windows)]
mod crypto {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    fn run(input: &[u8], seal: bool) -> Result<Vec<u8>, String> {
        let inb = CRYPT_INTEGER_BLOB { cbData: input.len() as u32, pbData: input.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: null_mut() };
        let ok = unsafe {
            if seal {
                CryptProtectData(&inb, null(), null(), null(), null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            } else {
                CryptUnprotectData(&inb, null_mut(), null(), null(), null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            }
        };
        if ok == 0 {
            return Err(format!("DPAPI {} failed", if seal { "encrypt" } else { "decrypt" }));
        }
        let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize) }.to_vec();
        unsafe { LocalFree(out.pbData as _) };
        Ok(bytes)
    }

    pub fn protect(b: &[u8]) -> Result<Vec<u8>, String> { run(b, true) }
    pub fn unprotect(b: &[u8]) -> Result<Vec<u8>, String> { run(b, false) }
}

// TODO(mac/linux): use the OS keychain. Plaintext for now so it still builds.
#[cfg(not(windows))]
mod crypto {
    pub fn protect(b: &[u8]) -> Result<Vec<u8>, String> { Ok(b.to_vec()) }
    pub fn unprotect(b: &[u8]) -> Result<Vec<u8>, String> { Ok(b.to_vec()) }
}
