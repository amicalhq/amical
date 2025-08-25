#include <napi.h>

#include "common.h"
#include "model.h"
#include "transcribe.h"

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("transcribe", Napi::Function::New(env, Transcribe));
    WhisperModel::Init(env, exports);

    if (IsProduction(env.Global())) {
        whisper_log_set([](ggml_log_level level, const char *text, void *user_data) {}, nullptr);
    }

    return exports;
}

NODE_API_MODULE(whisper, Init)
