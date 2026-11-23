//! Amical native helper for Linux. The desktop app starts it with no
//! arguments and talks NDJSON over stdin and stdout (see `rpc`). Logs go to
//! stderr (see `log`). stdout carries only JSON lines, and only `writer`
//! writes to it.
//!
//! Exit codes: 0 after SIGTERM, SIGINT, SIGHUP, stdin EOF or a closed stdout;
//! 1 when startup fails; 2 after a panic outside a request handler; 3 when
//! the X connection closes on an X11 session (see `x11`). The desktop
//! restarts the helper after a non-zero exit.

#![deny(clippy::print_stdout)]

mod caps;
mod dispatch;
mod log;
mod models;
mod portal;
mod remote_desktop;
mod rpc;
mod writer;
mod x11;

use std::sync::Arc;
use std::time::Duration;

use tokio::signal::unix::{signal, Signal, SignalKind};
use tokio::task::JoinError;

use crate::caps::SessionEnv;
use crate::dispatch::Ctx;
use crate::log::log;

const EXIT_OK: i32 = 0;
const EXIT_STARTUP_FAILED: i32 = 1;
const EXIT_PANIC: i32 = 2;
/// On an X11 session the X server is the session; a restarted helper
/// probes it again.
const EXIT_X_CONNECTION_LOST: i32 = 3;

/// How long requests still in flight at shutdown get to answer.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(1);

fn main() {
    log::install_panic_hook();
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            log!("Main", "cannot start the async runtime: {error}");
            std::process::exit(EXIT_STARTUP_FAILED);
        }
    };
    let code = runtime.block_on(run());
    // Exit without dropping the runtime: the thread that reads stdin can be
    // blocked in read(2), and dropping the runtime would wait for it.
    std::process::exit(code);
}

async fn run() -> i32 {
    // Signal handlers go in before the first request is read.
    let mut signals = match Signals::install() {
        Ok(signals) => signals,
        Err(error) => {
            log!("Main", "cannot install signal handlers: {error}");
            return EXIT_STARTUP_FAILED;
        }
    };
    let (out, lines) = writer::channel();
    let mut writer = tokio::spawn(writer::run(lines, tokio::io::stdout()));
    let ctx = Arc::new(Ctx::new(out, SessionEnv::from_process()));
    let mut reader = tokio::spawn(rpc::serve(tokio::io::stdin(), ctx.clone()));
    log!("Main", "linux-helper {} started", env!("CARGO_PKG_VERSION"));
    // Connect the X11 backend now, so that the first request finds it ready.
    let backends = ctx.clone();
    tokio::spawn(async move { backends.x11().await });

    let (reason, stdout_closed, code) = tokio::select! {
        result = &mut reader => match result {
            Ok(Ok(())) => ("stdin closed", false, EXIT_OK),
            Ok(Err(error)) => {
                log!("Main", "stdin read failed: {error}");
                ("stdin read failed", false, EXIT_OK)
            }
            Err(error) => return task_failed("reader", error),
        },
        name = signals.recv() => (name, false, EXIT_OK),
        result = &mut writer => match result {
            Ok(Ok(())) => ("stdout closed", true, EXIT_OK),
            Ok(Err(error)) => {
                log!("Main", "stdout write failed: {}", error.kind());
                ("stdout closed", true, EXIT_OK)
            }
            Err(error) => return task_failed("writer", error),
        },
        () = ctx.x11_lost() => ("X connection closed", false, EXIT_X_CONNECTION_LOST),
    };
    shutdown(&ctx, reason).await;

    if !stdout_closed {
        // The writer ends when the last handle to it is dropped: ours, the
        // reader's, and one per request in flight. Backend threads hold
        // weak handles, which do not keep it alive.
        reader.abort();
        drop(ctx);
        match tokio::time::timeout(SHUTDOWN_GRACE, writer).await {
            Ok(Err(error)) => return task_failed("writer", error),
            Ok(Ok(_)) => {}
            Err(_) => log!("Main", "requests still in flight after {SHUTDOWN_GRACE:?}"),
        }
    }
    code
}

/// Runs once before every orderly exit. A backend that changes system state
/// (audio mute, key grabs, portal sessions) undoes the change here.
async fn shutdown(ctx: &Ctx, reason: &str) {
    log!("Main", "shutting down: {reason}");
    ctx.shutdown().await;
}

fn task_failed(task: &str, error: JoinError) -> i32 {
    // The panic hook has already logged the panic itself.
    log!("Main", "the {task} task stopped: {error}");
    EXIT_PANIC
}

struct Signals {
    terminate: Signal,
    interrupt: Signal,
    hangup: Signal,
}

impl Signals {
    fn install() -> std::io::Result<Self> {
        Ok(Self {
            terminate: signal(SignalKind::terminate())?,
            interrupt: signal(SignalKind::interrupt())?,
            hangup: signal(SignalKind::hangup())?,
        })
    }

    async fn recv(&mut self) -> &'static str {
        tokio::select! {
            _ = self.terminate.recv() => "SIGTERM",
            _ = self.interrupt.recv() => "SIGINT",
            _ = self.hangup.recv() => "SIGHUP",
        }
    }
}
