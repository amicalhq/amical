//! The single stdout writer. Responses and events reach stdout only through
//! [`Out::send`], which serializes one JSON object per line, so stdout never
//! carries anything that is not a JSON line.

use serde::Serialize;
use tokio::io::{AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

use crate::log::log;

#[derive(Clone)]
pub struct Out(UnboundedSender<String>);

pub fn channel() -> (Out, UnboundedReceiver<String>) {
    let (sender, receiver) = unbounded_channel();
    (Out(sender), receiver)
}

impl Out {
    pub fn send<T: Serialize>(&self, message: &T) {
        match serde_json::to_string(message) {
            // An error means that the writer has stopped (stdout is closed
            // and the helper is shutting down), so the line has nowhere to go.
            Ok(line) => drop(self.0.send(line)),
            Err(error) => log!("Writer", "cannot serialize a message: {error}"),
        }
    }
}

/// Writes lines in the order they were sent and flushes each one. Returns
/// when every [`Out`] is dropped, or with the error of a failed write.
pub async fn run<W: AsyncWrite + Unpin>(
    mut lines: UnboundedReceiver<String>,
    mut stdout: W,
) -> std::io::Result<()> {
    while let Some(mut line) = lines.recv().await {
        line.push('\n');
        stdout.write_all(line.as_bytes()).await?;
        stdout.flush().await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[tokio::test]
    async fn writes_one_whole_line_per_message_in_order() {
        let (out, lines) = channel();
        for n in 0..200 {
            out.send(&json!({ "n": n, "text": "two\nlines" }));
        }
        drop(out);

        let mut stdout = Vec::new();
        run(lines, &mut stdout).await.unwrap();

        let stdout = String::from_utf8(stdout).unwrap();
        assert!(stdout.ends_with('\n'));
        let lines: Vec<&str> = stdout.lines().collect();
        assert_eq!(lines.len(), 200);
        for (n, line) in lines.iter().enumerate() {
            let message: Value = serde_json::from_str(line).unwrap();
            assert_eq!(message, json!({ "n": n, "text": "two\nlines" }));
        }
    }
}
