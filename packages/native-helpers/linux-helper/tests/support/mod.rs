//! Runs the built helper as the desktop does: no arguments, NDJSON over
//! stdin and stdout. Each helper gets a temporary HOME and XDG directories,
//! and either a private session bus or no bus at all, so that a test never
//! touches the user's home directory or session services.

// Each test binary uses its own part of this module.
#![allow(dead_code)]

use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

pub const TIMEOUT: Duration = Duration::from_secs(10);

pub fn schema(file: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../types/generated/json-schemas")
        .join(file);
    let text = fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "{}: {error}. Run `pnpm --filter @amical/types generate:all` first.",
            path.display()
        )
    });
    serde_json::from_str(&text).unwrap()
}

pub fn assert_valid(file: &str, instance: &Value) {
    let validator = jsonschema::validator_for(&schema(file)).unwrap();
    let errors: Vec<String> = validator
        .iter_errors(instance)
        .map(|error| error.to_string())
        .collect();
    assert!(
        errors.is_empty(),
        "{file}: {instance} is invalid: {errors:?}"
    );
}

/// A fresh directory under the system temp directory (short paths: a unix
/// socket path has a 108-byte limit), removed on drop.
pub struct TempDir(PathBuf);

impl TempDir {
    pub fn new(name: &str) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "linux-helper-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    pub fn path(&self) -> &Path {
        &self.0
    }

    fn subdir(&self, name: &str) -> PathBuf {
        let path = self.0.join(name);
        fs::create_dir_all(&path).unwrap();
        path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub struct Helper {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: Receiver<String>,
    /// Lines that arrived while `call` waited for its answer (events).
    pending: VecDeque<String>,
    stderr: Option<JoinHandle<String>>,
    stderr_text: String,
    next_id: usize,
    _home: TempDir,
}

impl Helper {
    /// `bus`: the address of a private bus, or None for no bus. `env`: more
    /// variables, for example the session type.
    pub fn spawn(bus: Option<&str>, env: &[(&str, &str)]) -> Self {
        let home = TempDir::new("home");
        let runtime_dir = home.subdir("runtime");
        fs::set_permissions(&runtime_dir, fs::Permissions::from_mode(0o700)).unwrap();
        let no_bus = format!("unix:path={}", home.path().join("no-bus").display());

        let mut child = Command::new(env!("CARGO_BIN_EXE_linux-helper"))
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("HOME", home.path())
            .env("XDG_CONFIG_HOME", home.subdir("config"))
            .env("XDG_DATA_HOME", home.subdir("data"))
            .env("XDG_STATE_HOME", home.subdir("state"))
            .env("XDG_CACHE_HOME", home.subdir("cache"))
            .env("XDG_RUNTIME_DIR", &runtime_dir)
            .env(
                "DBUS_SESSION_BUS_ADDRESS",
                bus.map_or(no_bus, str::to_owned),
            )
            .envs(env.iter().copied())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("cannot start the helper");

        let (sender, stdout) = channel();
        let child_stdout = child.stdout.take().unwrap();
        thread::spawn(move || {
            for line in BufReader::new(child_stdout).lines() {
                let Ok(line) = line else { break };
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        let mut child_stderr = child.stderr.take().unwrap();
        let stderr = thread::spawn(move || {
            let mut text = String::new();
            let _ = child_stderr.read_to_string(&mut text);
            text
        });

        Self {
            stdin: child.stdin.take(),
            child,
            stdout,
            pending: VecDeque::new(),
            stderr: Some(stderr),
            stderr_text: String::new(),
            next_id: 0,
            _home: home,
        }
    }

    pub fn send(&mut self, line: &str) {
        let stdin = self.stdin.as_mut().expect("stdin is closed");
        writeln!(stdin, "{line}").unwrap();
        stdin.flush().unwrap();
    }

    /// Sends a request and returns its answer. Other lines that arrive
    /// first stay for `next_line`.
    pub fn call(&mut self, method: &str, params: Value) -> Value {
        let id = self.send_request(method, params);
        self.answer(&id)
    }

    /// Sends a request without waiting; returns its id for `answer`.
    pub fn send_request(&mut self, method: &str, params: Value) -> String {
        self.next_id += 1;
        let id = format!("call-{}", self.next_id);
        self.send(&json!({ "id": id, "method": method, "params": params }).to_string());
        id
    }

    /// The answer to request `id`. Other lines stay for `next_line`.
    pub fn answer(&mut self, id: &str) -> Value {
        let is_answer = |line: &str| serde_json::from_str::<Value>(line).unwrap()["id"] == id;
        if let Some(index) = self.pending.iter().position(|line| is_answer(line)) {
            let line = self.pending.remove(index).unwrap();
            return serde_json::from_str(&line).unwrap();
        }
        loop {
            let line = match self.stdout.recv_timeout(TIMEOUT) {
                Ok(line) => line,
                Err(_) => panic!("no answer to {id} within {TIMEOUT:?}"),
            };
            if is_answer(&line) {
                return serde_json::from_str(&line).unwrap();
            }
            self.pending.push_back(line);
        }
    }

    pub fn next_line(&mut self) -> Option<String> {
        if let Some(line) = self.pending.pop_front() {
            return Some(line);
        }
        match self.stdout.recv_timeout(TIMEOUT) {
            Ok(line) => Some(line),
            Err(RecvTimeoutError::Disconnected) => None,
            Err(RecvTimeoutError::Timeout) => panic!("no stdout line within {TIMEOUT:?}"),
        }
    }

    /// The next stdout line within `wait`, or None.
    pub fn next_line_within(&mut self, wait: Duration) -> Option<String> {
        if let Some(line) = self.pending.pop_front() {
            return Some(line);
        }
        self.stdout.recv_timeout(wait).ok()
    }

    /// Every stdout line until the helper closes stdout.
    pub fn read_to_end(&mut self) -> Vec<String> {
        std::iter::from_fn(|| self.next_line()).collect()
    }

    pub fn close_stdin(&mut self) {
        self.stdin = None;
    }

    pub fn signal(&self, signal: libc::c_int) {
        let pid = libc::pid_t::try_from(self.child.id()).unwrap();
        // SAFETY: kill(2) with the pid of our own child process.
        assert_eq!(unsafe { libc::kill(pid, signal) }, 0);
    }

    pub fn wait(&mut self) -> ExitStatus {
        let deadline = Instant::now() + TIMEOUT;
        let status = loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                break status;
            }
            assert!(
                Instant::now() < deadline,
                "the helper did not exit within {TIMEOUT:?}"
            );
            thread::sleep(Duration::from_millis(10));
        };
        if let Some(stderr) = self.stderr.take() {
            self.stderr_text = stderr.join().unwrap();
        }
        status
    }

    /// Everything the helper wrote to stderr. Call after [`Helper::wait`].
    pub fn stderr(&self) -> &str {
        assert!(
            self.stderr.is_none(),
            "stderr is complete only after wait()"
        );
        &self.stderr_text
    }
}

impl Drop for Helper {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A session bus of our own. Its configuration has no service directories,
/// so nothing on it can be started on demand: no real portal, keyring or
/// accessibility bus.
pub struct PrivateBus {
    daemon: Child,
    pub address: String,
    _dir: TempDir,
}

impl PrivateBus {
    pub fn start() -> Self {
        let dir = TempDir::new("bus");
        let config = dir.path().join("session.conf");
        fs::write(
            &config,
            format!(
                r#"<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:path={}</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
"#,
                dir.path().join("socket").display()
            ),
        )
        .unwrap();

        let mut daemon = Command::new("dbus-daemon")
            .arg(format!("--config-file={}", config.display()))
            .arg("--nofork")
            .arg("--print-address=1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("dbus-daemon is needed for the private-bus tests (package: dbus)");
        // The daemon prints its address when it is ready.
        let mut address = String::new();
        BufReader::new(daemon.stdout.take().unwrap())
            .read_line(&mut address)
            .unwrap();
        assert!(!address.trim().is_empty(), "dbus-daemon printed no address");

        Self {
            daemon,
            address: address.trim().to_owned(),
            _dir: dir,
        }
    }
}

impl Drop for PrivateBus {
    fn drop(&mut self) {
        let _ = self.daemon.kill();
        let _ = self.daemon.wait();
    }
}
