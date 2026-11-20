//! Snippet storage: one JSON document, encrypted at rest with Windows DPAPI
//! (CurrentUser scope), at <app data>/snippets.dat.

use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    /// Optional in import files; generated from the name when missing.
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
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

    /// Validate and replace the whole list (the manager always sends everything).
    pub fn replace(&self, snippets: Vec<Snippet>) -> Result<(), String> {
        let mut seen = std::collections::HashSet::new();
        for s in &snippets {
            if s.id.is_empty() || !s.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                return Err(format!("Invalid snippet id: {:?}", s.id));
            }
            if !seen.insert(s.id.as_str()) {
                return Err(format!("Duplicate snippet id: {}", s.id));
            }
            if s.name.trim().is_empty() {
                return Err("Every snippet needs a name".into());
            }
        }
        self.save(&snippets)
    }

    /// Bulk import from a plain JSON file (a list of snippets). Merges: a snippet
    /// whose id already exists replaces it, everything else is added. Only `name`
    /// is required. On success the file is deleted so the plaintext doesn't
    /// linger; on any error it is left untouched so it can be fixed.
    pub fn import_plain(&self, file: &Path) -> Result<ImportReport, ImportError> {
        let text = fs::read_to_string(file).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => ImportError::Missing,
            _ => ImportError::Other(format!("Couldn't read import.json: {e}")),
        })?;
        let incoming: Vec<Snippet> = serde_json::from_str(text.trim_start_matches('\u{feff}'))
            .map_err(|e| ImportError::Other(format!(
                "import.json isn't a valid list of snippets ({e}). Each needs at least a \"name\"."
            )))?;
        if incoming.is_empty() {
            return Err(ImportError::Other("import.json is an empty list: nothing to import.".into()));
        }

        let mut all = self.load().map_err(ImportError::Other)?;
        let (mut added, mut updated) = (0, 0);
        for (n, mut s) in incoming.into_iter().enumerate() {
            if s.name.trim().is_empty() {
                return Err(ImportError::Other(format!("Snippet {} in import.json has no \"name\".", n + 1)));
            }
            if s.id.is_empty() {
                s.id = unique_id(&s.name, &all);
            }
            match all.iter_mut().find(|x| x.id == s.id) {
                Some(existing) => { *existing = s; updated += 1; }
                None => { all.push(s); added += 1; }
            }
        }
        self.replace(all).map_err(|e| ImportError::Other(format!("Nothing imported: {e}")))?;
        let _ = fs::remove_file(file);
        Ok(ImportReport { added, updated })
    }
}

pub struct ImportReport {
    pub added: usize,
    pub updated: usize,
}

pub enum ImportError {
    /// No import.json in the data folder.
    Missing,
    /// Anything else, already worded for people.
    Other(String),
}

/// "Bank details (USD)" → "bank-details-usd", with -2, -3… if taken.
fn unique_id(name: &str, all: &[Snippet]) -> String {
    let mut base: String = name
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    base.truncate(40);
    if base.is_empty() {
        base = "snippet".into();
    }
    let mut id = base.clone();
    let mut n = 2;
    while all.iter().any(|s| s.id == id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
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
        s("reminder", "Payment reminder (polite)",
          "Hi {client},\n\nA gentle reminder that invoice {invoice no} for {amount} was due on {due date}. Bank details are below for convenience.\n\n{{bank}}\n\nThanks",
          &["reminder", "overdue", "payment"], "Replies", false, false),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(tag: &str) -> (Store, PathBuf) {
        let dir = std::env::temp_dir().join(format!("stash-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        (Store::new(&dir), dir)
    }

    #[test]
    fn import_merges_generates_ids_and_deletes_file() {
        let (store, dir) = temp_store("merge");
        let seeded = store.load().unwrap().len();
        let file = dir.join("import.json");

        fs::write(&file, r#"[{"name":"Bank details (USD)","body":"x"},{"id":"gstin","name":"GSTIN","body":"NEW"}]"#).unwrap();
        let r = store.import_plain(&file).ok().unwrap();
        assert_eq!((r.added, r.updated), (1, 1));
        assert!(!file.exists(), "import.json should be deleted after a good import");

        let all = store.load().unwrap();
        assert_eq!(all.len(), seeded + 1);
        assert!(all.iter().any(|s| s.id == "bank-details-usd"));
        assert_eq!(all.iter().find(|s| s.id == "gstin").unwrap().body, "NEW");

        // Same name again gets a distinct id.
        fs::write(&file, r#"[{"name":"Bank details (USD)"}]"#).unwrap();
        store.import_plain(&file).ok().unwrap();
        assert!(store.load().unwrap().iter().any(|s| s.id == "bank-details-usd-2"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_errors_keep_the_file_and_the_store() {
        let (store, dir) = temp_store("errors");
        let before = store.load().unwrap().len();
        let file = dir.join("import.json");

        assert!(matches!(store.import_plain(&file), Err(ImportError::Missing)));

        for bad in [r#"[{"name":"x""#, r#"[{"body":"no name"}]"#, "[]", r#"[{"name":"  "}]"#] {
            fs::write(&file, bad).unwrap();
            match store.import_plain(&file) {
                Err(ImportError::Other(msg)) => assert!(!msg.is_empty()),
                _ => panic!("expected an error for {bad}"),
            }
            assert!(file.exists(), "a bad import.json must be kept so it can be fixed");
        }
        assert_eq!(store.load().unwrap().len(), before);
        let _ = fs::remove_dir_all(&dir);
    }
}
