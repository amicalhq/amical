//! NDJSON transport. The desktop writes one request per stdin line:
//! `{"id":"<uuid>","method":"<name>","params":{...}}`. The helper answers each
//! request with one stdout line: `{"id":"<id>","result":...}` or
//! `{"id":"<id>","error":{"code":-32602,"message":"...","data":...}}`.
//!
//! - An empty line is skipped. A line that is not a request envelope gets no
//!   answer and is logged by length only, because it can hold user text.
//! - An unknown method gets -32601.
//! - Each request runs on its own task, so answers can come out of order. The
//!   desktop matches them by id.

use std::future::Future;
use std::sync::Arc;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};

use crate::dispatch::{self, Ctx};
use crate::log::log;

pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;
pub const INTERNAL_ERROR: i64 = -32603;

#[derive(Debug, PartialEq, Serialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    pub fn internal(detail: &str) -> Self {
        Self {
            code: INTERNAL_ERROR,
            message: format!("Internal error: {detail}"),
            data: None,
        }
    }

    fn method_not_found() -> Self {
        Self {
            code: METHOD_NOT_FOUND,
            message: "Method not found".to_owned(),
            data: None,
        }
    }

    /// The error without its detail and data, for params that hold user text.
    /// A decode error can quote a value from the params.
    pub fn without_content(mut self) -> Self {
        if let Some(detail) = self.message.find(": ") {
            self.message.truncate(detail);
        }
        self.data = None;
        self
    }
}

/// A response line. It has `result` or `error`, never both, and never a null
/// in place of the one it does not use.
#[derive(Serialize)]
pub struct Response {
    id: String,
    #[serde(flatten)]
    outcome: Outcome,
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
enum Outcome {
    Result(Value),
    Error(RpcError),
}

impl Response {
    pub fn new(id: String, outcome: Result<Value, RpcError>) -> Self {
        let outcome = match outcome {
            Ok(result) => Outcome::Result(result),
            Err(error) => Outcome::Error(error),
        };
        Self { id, outcome }
    }
}

/// The envelope only. The method stays a string, so that an unknown method
/// still gets an answer with the request's id.
#[derive(Deserialize)]
struct Request {
    id: String,
    method: String,
    params: Option<Value>,
}

/// Decodes params that the method requires. Absent or null params are
/// "Missing params".
pub fn required<T: DeserializeOwned>(method: &str, params: Option<Value>) -> Result<T, RpcError> {
    match params {
        Some(params) if !params.is_null() => decode(method, params),
        _ => Err(RpcError {
            code: INVALID_PARAMS,
            message: format!("Missing params for {method}"),
            data: None,
        }),
    }
}

/// Decodes params in which every field is optional. Absent or null params
/// count as `{}`.
pub fn optional<T: DeserializeOwned>(method: &str, params: Option<Value>) -> Result<T, RpcError> {
    match params {
        Some(params) if !params.is_null() => decode(method, params),
        _ => decode(method, Value::Object(Default::default())),
    }
}

fn decode<T: DeserializeOwned>(method: &str, params: Value) -> Result<T, RpcError> {
    T::deserialize(&params).map_err(|error| RpcError {
        code: INVALID_PARAMS,
        message: format!("Invalid params for {method}: {error}"),
        data: Some(params),
    })
}

/// Reads requests until stdin closes, and answers each one on its own task.
pub async fn serve<R: AsyncRead + Unpin>(input: R, ctx: Arc<Ctx>) -> std::io::Result<()> {
    let mut input = BufReader::new(input);
    let mut line = Vec::new();
    loop {
        line.clear();
        if input.read_until(b'\n', &mut line).await? == 0 {
            return Ok(());
        }
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        match serde_json::from_slice::<Request>(&line) {
            Ok(request) => {
                tokio::spawn(answer(ctx.clone(), request));
            }
            Err(error) => log!(
                "Rpc",
                "dropped a line that is not a request ({:?} error, len={})",
                error.classify(),
                line.len()
            ),
        }
    }
}

async fn answer(ctx: Arc<Ctx>, request: Request) {
    let Request { id, method, params } = request;
    let outcome = match dispatch::method(&method) {
        Some(known) => {
            let handler_ctx = ctx.clone();
            catch_panic(async move { dispatch::handle(&handler_ctx, known, &method, params).await })
                .await
        }
        None => {
            log!("Rpc", "unknown method {method:?}");
            Err(RpcError::method_not_found())
        }
    };
    ctx.out.send(&Response::new(id, outcome));
}

/// Runs a handler on its own task, so that a panic becomes a -32603 answer
/// instead of a request that the desktop waits on until it times out.
async fn catch_panic<F>(handler: F) -> Result<Value, RpcError>
where
    F: Future<Output = Result<Value, RpcError>> + Send + 'static,
{
    tokio::spawn(handler)
        .await
        .unwrap_or_else(|_| Err(RpcError::internal("the request handler panicked")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_panicking_handler_answers_internal_error() {
        let outcome = catch_panic(async { panic!("test panic") }).await;
        assert_eq!(
            outcome,
            Err(RpcError {
                code: INTERNAL_ERROR,
                message: "Internal error: the request handler panicked".to_owned(),
                data: None,
            })
        );
    }
}
