#include "common.h"

Napi::Promise PromiseWorker::Promise() { return promise.Promise(); }

bool IsProduction(const Napi::Object global_env) {
    Napi::Object process = global_env.Get("process").As<Napi::Object>();
    Napi::Object env = process.Get("env").As<Napi::Object>();
    Napi::Value  node_env = env.Get("NODE_ENV");

    if (!node_env.IsString()) {
        return false;
    }

    Napi::String node_env_str = node_env.As<Napi::String>();
    return node_env_str.Utf8Value() == "production";
}
