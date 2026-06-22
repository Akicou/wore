/// WoRe — Tauri host.
///
/// The entire application lives in the webview (React + Vite). This host just
/// boots the window; all document + AI work happens in the frontend.
/// The one native helper exposed is `scan_env_keys`: it reads known AI-provider
/// environment variables from the user's shell/system and returns them so the
/// app can auto-fill API profiles without storing them in a remote service.
use serde::Serialize;
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

static ENV_KEY_NAMES: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_OAUTH_TOKEN",
    "OPENAI_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "MISTRAL_API_KEY",
    "OPENROUTER_API_KEY",
    "XAI_API_KEY",
    "FIREWORKS_API_KEY",
    "TOGETHER_API_KEY",
    "CEREBRAS_API_KEY",
    "NVIDIA_API_KEY",
    "MOONSHOT_API_KEY",
    "MINIMAX_API_KEY",
    "KIMI_API_KEY",
    "OPENCODE_API_KEY",
];

/// Map the discovered provider name to the profile name used in the frontend.
fn provider_name_from_key_name(key_name: &str) -> String {
    let name = match key_name {
        "ANTHROPIC_API_KEY" | "ANTHROPIC_OAUTH_TOKEN" => "Anthropic",
        "OPENAI_API_KEY" => "OpenAI",
        "AZURE_OPENAI_API_KEY" => "Azure OpenAI",
        "DEEPSEEK_API_KEY" => "DeepSeek",
        "GEMINI_API_KEY" => "Google Gemini",
        "GROQ_API_KEY" => "Groq",
        "MISTRAL_API_KEY" => "Mistral",
        "OPENROUTER_API_KEY" => "OpenRouter",
        "XAI_API_KEY" => "xAI Grok",
        "FIREWORKS_API_KEY" => "Fireworks",
        "TOGETHER_API_KEY" => "Together AI",
        "CEREBRAS_API_KEY" => "Cerebras",
        "NVIDIA_API_KEY" => "NVIDIA NIM",
        "MOONSHOT_API_KEY" => "Moonshot",
        "MINIMAX_API_KEY" => "MiniMax",
        "KIMI_API_KEY" => "Kimi",
        "OPENCODE_API_KEY" => "OpenCode",
        _ => key_name,
    };
    name.to_string()
}

/// Profile name mapping for the frontend presets.
fn profile_name_from_provider(provider: &str) -> String {
    match provider {
        "OpenAI" => "OpenAI".into(),
        "Anthropic" => "Anthropic".into(),
        "OpenRouter" => "OpenRouter".into(),
        _ => provider.into(),
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EnvKeyResult {
    profile_name: String,
    key: String,
    source: String,
}

/// Document file extensions the app is allowed to read. The native read
/// commands are callable from the webview, so without this an injected script
/// could read arbitrary files (SSH keys, `.env`, credentials). Restricting to
/// document types keeps the open/import features working while removing that.
static ALLOWED_DOC_EXTS: &[&str] = &[
    "md", "markdown", "txt", "text", "html", "htm", "docx", "doc", "pdf", "pptx", "ppt", "rtf", "odt",
];

fn document_ext(path: &std::path::Path) -> String {
    path.extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn is_allowed_document(path: &std::path::Path) -> bool {
    ALLOWED_DOC_EXTS.contains(&document_ext(path).as_str())
}

#[derive(Serialize)]
struct ReadDocResult {
    ok: bool,
    path: String,
    name: String,
    size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
fn check_document_path(path: String) -> ReadDocResult {
    let p = std::path::Path::new(&path);
    let name = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".into());
    if !is_allowed_document(p) {
        return ReadDocResult {
            ok: false,
            path,
            name,
            size: 0,
            text: None,
            error: Some("Unsupported file type.".into()),
        };
    }
    match std::fs::metadata(&p) {
        Ok(meta) => ReadDocResult {
            ok: true,
            path,
            name,
            size: meta.len(),
            text: None,
            error: None,
        },
        Err(e) => ReadDocResult {
            ok: false,
            path,
            name,
            size: 0,
            text: None,
            error: Some(e.to_string()),
        },
    }
}

#[derive(Serialize)]
struct DocBytesResult {
    ok: bool,
    path: String,
    name: String,
    ext: String,
    size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn base64_encode(bytes: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() * 4 + 2) / 3);
    let mut i = 0;
    while i + 2 < bytes.len() {
        let b = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8) | (bytes[i + 2] as u32);
        out.push(CHARS[((b >> 18) & 0x3f) as usize] as char);
        out.push(CHARS[((b >> 12) & 0x3f) as usize] as char);
        out.push(CHARS[((b >> 6) & 0x3f) as usize] as char);
        out.push(CHARS[(b & 0x3f) as usize] as char);
        i += 3;
    }
    if i + 1 == bytes.len() {
        let b = (bytes[i] as u32) << 16;
        out.push(CHARS[((b >> 18) & 0x3f) as usize] as char);
        out.push(CHARS[((b >> 12) & 0x3f) as usize] as char);
        out.push('=');
        out.push('=');
    } else if i + 2 == bytes.len() {
        let b = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8);
        out.push(CHARS[((b >> 18) & 0x3f) as usize] as char);
        out.push(CHARS[((b >> 12) & 0x3f) as usize] as char);
        out.push(CHARS[((b >> 6) & 0x3f) as usize] as char);
        out.push('=');
    }
    out
}

#[tauri::command]
fn read_document_bytes(path: String) -> DocBytesResult {
    let p = std::path::Path::new(&path);
    let name = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".into());
    let ext = p
        .extension()
        .map(|s| s.to_string_lossy().to_string().to_lowercase())
        .unwrap_or_default();
    if !is_allowed_document(p) {
        return DocBytesResult {
            ok: false,
            path,
            name,
            ext,
            size: 0,
            bytes_base64: None,
            error: Some("Unsupported file type.".into()),
        };
    }
    match std::fs::metadata(&p) {
        Ok(meta) => {
            if meta.len() > 25 * 1024 * 1024 {
                return DocBytesResult {
                    ok: false,
                    path,
                    name,
                    ext,
                    size: meta.len(),
                    bytes_base64: None,
                    error: Some("File is too large (max 25 MB).".into()),
                };
            }
            match std::fs::read(&p) {
                Ok(bytes) => DocBytesResult {
                    ok: true,
                    path,
                    name,
                    ext,
                    size: meta.len(),
                    bytes_base64: Some(base64_encode(&bytes)),
                    error: None,
                },
                Err(e) => DocBytesResult {
                    ok: false,
                    path,
                    name,
                    ext,
                    size: meta.len(),
                    bytes_base64: None,
                    error: Some(format!("Could not read file: {}", e)),
                },
            }
        }
        Err(e) => DocBytesResult {
            ok: false,
            path,
            name,
            ext,
            size: 0,
            bytes_base64: None,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
fn read_document_file(path: String) -> ReadDocResult {
    let p = std::path::Path::new(&path);
    let name = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".into());
    if !is_allowed_document(p) {
        return ReadDocResult {
            ok: false,
            path,
            name,
            size: 0,
            text: None,
            error: Some("Unsupported file type.".into()),
        };
    }
    match std::fs::metadata(&p) {
        Ok(meta) => {
            if meta.len() > 10 * 1024 * 1024 {
                return ReadDocResult {
                    ok: false,
                    path,
                    name,
                    size: meta.len(),
                    text: None,
                    error: Some("File is too large (max 10 MB).".into()),
                };
            }
            match std::fs::read_to_string(&p) {
                Ok(text) => ReadDocResult {
                    ok: true,
                    path,
                    name,
                    size: meta.len(),
                    text: Some(text),
                    error: None,
                },
                Err(e) => ReadDocResult {
                    ok: false,
                    path,
                    name,
                    size: meta.len(),
                    text: None,
                    error: Some(format!("Could not read file: {}", e)),
                },
            }
        }
        Err(e) => ReadDocResult {
            ok: false,
            path,
            name,
            size: 0,
            text: None,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
fn get_log_path() -> String {
    log_file_path().to_string_lossy().to_string()
}

/// Strip CR/LF and other control chars so caller-supplied fields cannot forge
/// extra log lines (log injection).
fn sanitize_log_field(s: &str) -> String {
    s.chars()
        .map(|c| if c == '\n' || c == '\r' || c.is_control() { ' ' } else { c })
        .collect()
}

#[tauri::command]
fn write_log(level: String, area: String, message: String, details: Option<String>) -> Result<(), String> {
    let path = log_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let level = sanitize_log_field(&level);
    let area = sanitize_log_field(&area);
    let message = sanitize_log_field(&message);
    writeln!(file, "[{ts}] [{level}] [{area}] {message}").map_err(|e| e.to_string())?;
    if let Some(details) = details {
        for line in details.lines() {
            writeln!(file, "    {line}").map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn log_file_path() -> PathBuf {
    if let Ok(appdata) = env::var("APPDATA") {
        return PathBuf::from(appdata).join("WoRe").join("logs").join("wore.log");
    }
    if let Ok(local) = env::var("LOCALAPPDATA") {
        return PathBuf::from(local).join("WoRe").join("logs").join("wore.log");
    }
    env::temp_dir().join("WoRe").join("logs").join("wore.log")
}

#[tauri::command]
fn scan_env_keys() -> Vec<EnvKeyResult> {
    ENV_KEY_NAMES
        .iter()
        .filter_map(|name| {
            env::var(name)
                .ok()
                .or_else(|| read_windows_env_from_registry(name))
                .filter(|key| !key.trim().is_empty())
                .map(|key| EnvKeyResult {
                    profile_name: profile_name_from_provider(&provider_name_from_key_name(name)),
                    key,
                    source: name.to_string(),
                })
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn read_windows_env_from_registry(name: &str) -> Option<String> {
    // Installed apps launched from Start Menu may not inherit shell env vars.
    // Fall back to persistent user/machine environment registry values.
    //
    // We read the registry directly via the native API instead of shelling out
    // to `reg.exe`. Spawning dozens of console processes in a tight loop (one per
    // provider key × root) was both slow and fragile: rapid CreateProcess calls
    // from the GUI host intermittently failed DLL init (0xc0000142), surfacing a
    // "reg.exe - Application Error" dialog and flashing console windows.
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let roots = [
        (HKEY_CURRENT_USER, "Environment"),
        (
            HKEY_LOCAL_MACHINE,
            "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
        ),
    ];
    for (hkey, subkey) in roots {
        let Ok(env_key) = RegKey::predef(hkey).open_subkey(subkey) else {
            continue;
        };
        // get_value handles REG_SZ and REG_EXPAND_SZ, including values with spaces.
        if let Ok(value) = env_key.get_value::<String, _>(name) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn read_windows_env_from_registry(_name: &str) -> Option<String> {
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            scan_env_keys,
            write_log,
            get_log_path,
            check_document_path,
            read_document_file,
            read_document_bytes,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running WoRe");
}
