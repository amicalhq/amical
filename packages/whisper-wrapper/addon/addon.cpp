#include "napi.h"

#include "whisper.h"
#include "common.h"
#include "common-whisper.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

struct WhisperHandle {
  std::mutex mutex;
  whisper_context* ctx = nullptr;
  bool freed = false;
};

struct TokenData {
  std::string text;
  int id = 0;
  float p = 0.0f;
  int from_ms = -1;
  int to_ms = -1;
};

struct SegmentData {
  int from_ms = 0;
  int to_ms = 0;
  std::string text;
  float confidence = 0.0f;
  std::string language;
  std::vector<TokenData> tokens;
};

struct FullParamConfig {
  whisper_full_params params;
  std::string initial_prompt;
  std::string language;
  bool detailed = false;
  bool token_timestamps = false;
};

FullParamConfig parse_full_params(const Napi::Env env, const Napi::Object& options) {
  FullParamConfig cfg;
  cfg.params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);

  if (options.Has("strategy")) {
    cfg.params.strategy = static_cast<whisper_sampling_strategy>(
      options.Get("strategy").As<Napi::Number>().Int32Value());
  }
  if (options.Has("n_threads")) {
    cfg.params.n_threads = options.Get("n_threads").As<Napi::Number>().Int32Value();
  }
  if (options.Has("n_max_text_ctx")) {
    cfg.params.n_max_text_ctx = options.Get("n_max_text_ctx").As<Napi::Number>().Int32Value();
  }
  if (options.Has("offset_ms")) {
    cfg.params.offset_ms = options.Get("offset_ms").As<Napi::Number>().Int32Value();
  }
  if (options.Has("duration_ms")) {
    cfg.params.duration_ms = options.Get("duration_ms").As<Napi::Number>().Int32Value();
  }

  if (options.Has("translate")) {
    cfg.params.translate = options.Get("translate").As<Napi::Boolean>().Value();
  }
  if (options.Has("no_context")) {
    cfg.params.no_context = options.Get("no_context").As<Napi::Boolean>().Value();
  }
  if (options.Has("no_timestamps")) {
    cfg.params.no_timestamps = options.Get("no_timestamps").As<Napi::Boolean>().Value();
  }
  if (options.Has("single_segment")) {
    cfg.params.single_segment = options.Get("single_segment").As<Napi::Boolean>().Value();
  }
  if (options.Has("print_special")) {
    cfg.params.print_special = options.Get("print_special").As<Napi::Boolean>().Value();
  }
  if (options.Has("print_progress")) {
    cfg.params.print_progress = options.Get("print_progress").As<Napi::Boolean>().Value();
  } else {
    cfg.params.print_progress = false;
  }
  if (options.Has("print_realtime")) {
    cfg.params.print_realtime = options.Get("print_realtime").As<Napi::Boolean>().Value();
  }
  if (options.Has("print_timestamps")) {
    cfg.params.print_timestamps = options.Get("print_timestamps").As<Napi::Boolean>().Value();
  }

  if (options.Has("token_timestamps")) {
    cfg.params.token_timestamps = options.Get("token_timestamps").As<Napi::Boolean>().Value();
  }
  cfg.token_timestamps = cfg.params.token_timestamps;

  if (options.Has("thold_pt")) {
    cfg.params.thold_pt = options.Get("thold_pt").As<Napi::Number>();
  }
  if (options.Has("thold_ptsum")) {
    cfg.params.thold_ptsum = options.Get("thold_ptsum").As<Napi::Number>();
  }
  if (options.Has("max_len")) {
    cfg.params.max_len = options.Get("max_len").As<Napi::Number>().Int32Value();
  }
  if (options.Has("split_on_word")) {
    cfg.params.split_on_word = options.Get("split_on_word").As<Napi::Boolean>().Value();
  }
  if (options.Has("max_tokens")) {
    cfg.params.max_tokens = options.Get("max_tokens").As<Napi::Number>().Int32Value();
  }

  if (options.Has("debug_mode")) {
    cfg.params.debug_mode = options.Get("debug_mode").As<Napi::Boolean>().Value();
  }
  if (options.Has("audio_ctx")) {
    cfg.params.audio_ctx = options.Get("audio_ctx").As<Napi::Number>().Int32Value();
  }

  if (options.Has("tdrz_enable")) {
    cfg.params.tdrz_enable = options.Get("tdrz_enable").As<Napi::Boolean>().Value();
  }

  if (options.Has("initial_prompt") && options.Get("initial_prompt").IsString()) {
    cfg.initial_prompt = options.Get("initial_prompt").As<Napi::String>();
  }

  if (options.Has("language") && options.Get("language").IsString()) {
    cfg.language = options.Get("language").As<Napi::String>();
  } else {
    cfg.language = "auto";
  }

  if (options.Has("suppress_blank")) {
    cfg.params.suppress_blank = options.Get("suppress_blank").As<Napi::Boolean>().Value();
  }
  if (options.Has("suppress_non_speech_tokens")) {
    cfg.params.suppress_nst = options.Get("suppress_non_speech_tokens").As<Napi::Boolean>().Value();
  }

  if (options.Has("temperature")) {
    cfg.params.temperature = options.Get("temperature").As<Napi::Number>();
  }
  if (options.Has("max_initial_ts")) {
    cfg.params.max_initial_ts = options.Get("max_initial_ts").As<Napi::Number>().Int32Value();
  }
  if (options.Has("length_penalty")) {
    cfg.params.length_penalty = options.Get("length_penalty").As<Napi::Number>();
  }

  if (options.Has("temperature_inc")) {
    cfg.params.temperature_inc = options.Get("temperature_inc").As<Napi::Number>();
  }
  if (options.Has("entropy_thold")) {
    cfg.params.entropy_thold = options.Get("entropy_thold").As<Napi::Number>();
  }
  if (options.Has("logprob_thold")) {
    cfg.params.logprob_thold = options.Get("logprob_thold").As<Napi::Number>();
  }
  if (options.Has("no_speech_thold")) {
    cfg.params.no_speech_thold = options.Get("no_speech_thold").As<Napi::Number>();
  }

  if (options.Has("best_of")) {
    cfg.params.greedy.best_of = options.Get("best_of").As<Napi::Number>().Int32Value();
  }
  if (options.Has("beam_size")) {
    cfg.params.beam_search.beam_size = options.Get("beam_size").As<Napi::Number>().Int32Value();
    if (cfg.params.beam_search.beam_size > 1) {
      cfg.params.strategy = WHISPER_SAMPLING_BEAM_SEARCH;
    }
  }

  if (options.Has("prompt") && options.Get("prompt").IsString() && cfg.initial_prompt.empty()) {
    cfg.initial_prompt = options.Get("prompt").As<Napi::String>();
  }

  if (options.Has("format") && options.Get("format").IsString()) {
    std::string format = options.Get("format").As<Napi::String>();
    std::transform(format.begin(), format.end(), format.begin(), ::tolower);
    cfg.detailed = (format == "detail");
  }

  if (options.Has("detect_language")) {
    cfg.params.detect_language = options.Get("detect_language").As<Napi::Boolean>().Value();
  }

  if (cfg.language.empty()) {
    cfg.language = "auto";
  }

  return cfg;
}

Napi::External<WhisperHandle> wrap_handle(Napi::Env env, WhisperHandle* handle) {
  return Napi::External<WhisperHandle>::New(
    env,
    handle,
    [](Napi::Env /*env*/, WhisperHandle* ptr) {
      if (!ptr) return;
      std::lock_guard<std::mutex> guard(ptr->mutex);
      if (!ptr->freed && ptr->ctx) {
        whisper_free(ptr->ctx);
        ptr->ctx = nullptr;
        ptr->freed = true;
      }
      delete ptr;
    });
}

WhisperHandle* unwrap_handle(const Napi::CallbackInfo& info, size_t index) {
  if (info.Length() <= index || !info[index].IsExternal()) {
    throw Napi::TypeError::New(info.Env(), "Invalid context handle");
  }
  return info[index].As<Napi::External<WhisperHandle>>().Data();
}

std::vector<float> extract_audio(const Napi::Env env, const Napi::Object& options) {
  std::vector<float> pcmf32;
  if (options.Has("audio") && options.Get("audio").IsTypedArray()) {
    Napi::Float32Array array = options.Get("audio").As<Napi::Float32Array>();
    pcmf32.resize(array.ElementLength());
    std::copy(array.Data(), array.Data() + array.ElementLength(), pcmf32.begin());
  }
  return pcmf32;
}

std::vector<std::string> extract_files(const Napi::Object& options) {
  std::vector<std::string> files;
  if (options.Has("fname_inp")) {
    const auto value = options.Get("fname_inp");
    if (value.IsString()) {
      files.emplace_back(value.As<Napi::String>());
    }
  }
  return files;
}

Napi::Value init_model(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    throw Napi::TypeError::New(env, "Expected init options object");
  }

  auto options = info[0].As<Napi::Object>();
  if (!options.Has("model") || !options.Get("model").IsString()) {
    throw Napi::TypeError::New(env, "Missing 'model' path");
  }

  std::string model = options.Get("model").As<Napi::String>();
  bool use_gpu = true;
  if (options.Has("gpu")) {
    use_gpu = options.Get("gpu").As<Napi::Boolean>();
  } else if (options.Has("use_gpu")) {
    use_gpu = options.Get("use_gpu").As<Napi::Boolean>();
  }

  bool flash_attn = false;
  if (options.Has("flash_attn")) {
    flash_attn = options.Get("flash_attn").As<Napi::Boolean>();
  }

  whisper_context_params cparams = whisper_context_default_params();
  cparams.use_gpu = use_gpu;
  cparams.flash_attn = flash_attn;

  whisper_context* ctx = whisper_init_from_file_with_params(model.c_str(), cparams);
  if (ctx == nullptr) {
    throw Napi::Error::New(env, "Failed to initialize whisper context");
  }

  auto* handle = new WhisperHandle();
  handle->ctx = ctx;

  return wrap_handle(env, handle);
}

Napi::Value free_model(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  WhisperHandle* handle = unwrap_handle(info, 0);

  std::lock_guard<std::mutex> guard(handle->mutex);
  if (!handle->freed && handle->ctx) {
    whisper_free(handle->ctx);
    handle->ctx = nullptr;
    handle->freed = true;
  }

  return env.Undefined();
}

Napi::Array build_segments(const Napi::Env env,
                           whisper_context* ctx,
                           const FullParamConfig& cfg,
                           const std::vector<float>& pcmf32,
                           const std::vector<std::vector<float>>& pcmf32s) {
  const int n_segments = whisper_full_n_segments(ctx);
  Napi::Array segments = Napi::Array::New(env, n_segments);

  const std::string detected_language = whisper_lang_str(whisper_full_lang_id(ctx));

  for (int i = 0; i < n_segments; ++i) {
    SegmentData segment;
    segment.from_ms = whisper_full_get_segment_t0(ctx, i) * 10;
    segment.to_ms = whisper_full_get_segment_t1(ctx, i) * 10;
    segment.text = whisper_full_get_segment_text(ctx, i);

    if (cfg.detailed) {
      const int n_tokens = whisper_full_n_tokens(ctx, i);
      segment.tokens.reserve(n_tokens);

      float confidence_sum = 0.0f;
      float min_p = 1.0f;
      float max_p = 0.0f;
      int valid_tokens = 0;

      for (int j = 0; j < n_tokens; ++j) {
        whisper_token_data token = whisper_full_get_token_data(ctx, i, j);

        TokenData token_data;
        token_data.text = whisper_full_get_token_text(ctx, i, j);
        token_data.id = token.id;
        token_data.p = token.p;
        if (cfg.token_timestamps) {
          token_data.from_ms = token.t0 * 10;
          token_data.to_ms = token.t1 * 10;
        }

        segment.tokens.push_back(std::move(token_data));

        if (token.id > whisper_token_eot(ctx)) {
          continue;
        }

        confidence_sum += token.p;
        min_p = std::min(min_p, token.p);
        max_p = std::max(max_p, token.p);
        ++valid_tokens;
      }

      if (valid_tokens > 2) {
        segment.confidence =
          (confidence_sum - min_p - max_p) / static_cast<float>(valid_tokens - 2);
      } else if (valid_tokens > 0) {
        segment.confidence = confidence_sum / static_cast<float>(valid_tokens);
      } else {
        segment.confidence = 0.0f;
      }

      segment.language = detected_language;
    }

    Napi::Object jsSegment = Napi::Object::New(env);
    jsSegment.Set("from", Napi::Number::New(env, segment.from_ms));
    jsSegment.Set("to", Napi::Number::New(env, segment.to_ms));
    jsSegment.Set("text", Napi::String::New(env, segment.text));

    if (cfg.detailed) {
      jsSegment.Set("lang", Napi::String::New(env, segment.language));
      jsSegment.Set("confidence", Napi::Number::New(env, segment.confidence));

      Napi::Array jsTokens = Napi::Array::New(env, segment.tokens.size());
      for (size_t t = 0; t < segment.tokens.size(); ++t) {
        const TokenData& token = segment.tokens[t];
        Napi::Object jsToken = Napi::Object::New(env);
        jsToken.Set("text", Napi::String::New(env, token.text));
        jsToken.Set("id", Napi::Number::New(env, token.id));
        jsToken.Set("p", Napi::Number::New(env, token.p));
        if (cfg.token_timestamps) {
          jsToken.Set("from", Napi::Number::New(env, token.from_ms));
          jsToken.Set("to", Napi::Number::New(env, token.to_ms));
        }
        jsTokens.Set(t, jsToken);
      }

      jsSegment.Set("tokens", jsTokens);
    }

    segments.Set(i, jsSegment);
  }

  return segments;
}

Napi::Value full_transcribe(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsObject()) {
    throw Napi::TypeError::New(env, "Expected arguments (handle, options)");
  }

  WhisperHandle* handle = unwrap_handle(info, 0);
  if (handle->freed || handle->ctx == nullptr) {
    throw Napi::Error::New(env, "Model has been freed");
  }

  auto options = info[1].As<Napi::Object>();

  std::vector<float> pcmf32 = extract_audio(env, options);
  std::vector<std::vector<float>> pcmf32s;
  std::vector<std::string> files = extract_files(options);

  if (pcmf32.empty()) {
    if (files.empty()) {
      throw Napi::Error::New(env, "No audio provided (audio buffer or fname_inp required)");
    }
    if (!::read_audio_data(files[0], pcmf32, pcmf32s, false)) {
      throw Napi::Error::New(env, "Failed to read input audio file");
    }
  }

  FullParamConfig cfg = parse_full_params(env, options);

  if (cfg.language.empty()) {
    cfg.language = "auto";
  }

  cfg.params.language = cfg.language.c_str();
  cfg.params.initial_prompt = cfg.initial_prompt.empty() ? nullptr : cfg.initial_prompt.c_str();

  int n_processors = 1;
  if (options.Has("n_processors")) {
    n_processors = std::max(1, options.Get("n_processors").As<Napi::Number>().Int32Value());
  }

  std::lock_guard<std::mutex> guard(handle->mutex);

  int result = whisper_full_parallel(
    handle->ctx,
    cfg.params,
    pcmf32.data(),
    static_cast<int>(pcmf32.size()),
    n_processors);

  if (result != 0) {
    throw Napi::Error::New(env, "whisper_full_parallel failed");
  }

  return build_segments(env, handle->ctx, cfg, pcmf32, pcmf32s);
}

} // namespace

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  exports.Set("init", Napi::Function::New(env, init_model));
  exports.Set("full", Napi::Function::New(env, full_transcribe));
  exports.Set("free", Napi::Function::New(env, free_model));
  return exports;
}

NODE_API_MODULE(whisper, InitAll)
