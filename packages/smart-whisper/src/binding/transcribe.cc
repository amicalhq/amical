#include "transcribe.h"

struct smart_whisper_transcribe_params {
    const char* format;
};

struct whisper_full_params whisper_full_params_from_js(Napi::Object o) {
    struct whisper_full_params params =
        whisper_full_default_params(whisper_sampling_strategy::WHISPER_SAMPLING_BEAM_SEARCH);

    if (o.Has("strategy")) {
        params.strategy = static_cast<whisper_sampling_strategy>(
            o.Get("strategy").As<Napi::Number>().Int32Value());
    }
    if (o.Has("n_threads")) {
        params.n_threads = o.Get("n_threads").As<Napi::Number>();
    }
    if (o.Has("n_max_text_ctx")) {
        params.n_max_text_ctx = o.Get("n_max_text_ctx").As<Napi::Number>();
    }
    if (o.Has("offset_ms")) {
        params.offset_ms = o.Get("offset_ms").As<Napi::Number>();
    }
    if (o.Has("duration_ms")) {
        params.duration_ms = o.Get("duration_ms").As<Napi::Number>();
    }

    if (o.Has("translate")) {
        params.translate = o.Get("translate").As<Napi::Boolean>();
    }
    if (o.Has("no_context")) {
        params.no_context = o.Get("no_context").As<Napi::Boolean>();
    }
    if (o.Has("no_timestamps")) {
        params.no_timestamps = o.Get("no_timestamps").As<Napi::Boolean>();
    }
    if (o.Has("single_segment")) {
        params.single_segment = o.Get("single_segment").As<Napi::Boolean>();
    }
    if (o.Has("print_special")) {
        params.print_special = o.Get("print_special").As<Napi::Boolean>();
    }
    if (o.Has("print_progress")) {
        params.print_progress = o.Get("print_progress").As<Napi::Boolean>();
    }
    if (o.Has("print_realtime")) {
        params.print_realtime = o.Get("print_realtime").As<Napi::Boolean>();
    }
    if (o.Has("print_timestamps")) {
        params.print_timestamps = o.Get("print_timestamps").As<Napi::Boolean>();
    }

    if (o.Has("token_timestamps")) {
        params.token_timestamps = o.Get("token_timestamps").As<Napi::Boolean>();
    }
    if (o.Has("thold_pt")) {
        params.thold_pt = o.Get("thold_pt").As<Napi::Number>();
    }
    if (o.Has("thold_ptsum")) {
        params.thold_ptsum = o.Get("thold_ptsum").As<Napi::Number>();
    }
    if (o.Has("max_len")) {
        params.max_len = o.Get("max_len").As<Napi::Number>();
    }
    if (o.Has("split_on_word")) {
        params.split_on_word = o.Get("split_on_word").As<Napi::Boolean>();
    }
    if (o.Has("max_tokens")) {
        params.max_tokens = o.Get("max_tokens").As<Napi::Number>();
    }

    if (o.Has("debug_mode")) {
        params.debug_mode = o.Get("debug_mode").As<Napi::Boolean>();
    }
    if (o.Has("audio_ctx")) {
        params.audio_ctx = o.Get("audio_ctx").As<Napi::Number>();
    }

    if (o.Has("tdrz_enable")) {
        params.tdrz_enable = o.Get("tdrz_enable").As<Napi::Boolean>();
    }

    if (o.Has("initial_prompt") && o.Get("initial_prompt").IsString()) {
        std::string initial_prompt = o.Get("initial_prompt").As<Napi::String>().Utf8Value();
        params.initial_prompt = strdup(initial_prompt.c_str());
    } else {
        params.initial_prompt = nullptr;
    }

    if (o.Has("language") && o.Get("language").IsString()) {
        std::string language = o.Get("language").As<Napi::String>().Utf8Value();
        params.language = strdup(language.c_str());
    } else {
        params.language = strdup("auto");
    }

    if (o.Has("suppress_blank") && o.Get("suppress_blank").IsBoolean()) {
        params.suppress_blank = o.Get("suppress_blank").As<Napi::Boolean>();
    }
    if (o.Has("suppress_non_speech_tokens") && o.Get("suppress_non_speech_tokens").IsBoolean()) {
        params.suppress_non_speech_tokens = o.Get("suppress_non_speech_tokens").As<Napi::Boolean>();
    }

    if (o.Has("temperature")) {
        params.temperature = o.Get("temperature").As<Napi::Number>();
    }
    if (o.Has("max_initial_ts")) {
        params.max_initial_ts = o.Get("max_initial_ts").As<Napi::Number>();
    }
    if (o.Has("length_penalty")) {
        params.length_penalty = o.Get("length_penalty").As<Napi::Number>();
    }

    if (o.Has("temperature_inc")) {
        params.temperature_inc = o.Get("temperature_inc").As<Napi::Number>();
    }
    if (o.Has("entropy_thold")) {
        params.entropy_thold = o.Get("entropy_thold").As<Napi::Number>();
    }
    if (o.Has("logprob_thold")) {
        params.logprob_thold = o.Get("logprob_thold").As<Napi::Number>();
    }
    if (o.Has("no_speech_thold")) {
        params.no_speech_thold = o.Get("no_speech_thold").As<Napi::Number>();
    }

    if (o.Has("best_of")) {
        params.greedy.best_of = o.Get("best_of").As<Napi::Number>();
    }

    if (o.Has("beam_size")) {
        params.beam_search.beam_size = o.Get("beam_size").As<Napi::Number>();
    }

    return params;
}

struct smart_whisper_transcribe_params smart_whisper_transcribe_params_from_js(Napi::Object o) {
    struct smart_whisper_transcribe_params params;

    if (o.Has("format") && o.Get("format").IsString()) {
        std::string format = o.Get("format").As<Napi::String>().Utf8Value();
        params.format = strdup(format.c_str());
    } else {
        params.format = strdup("simple");
    }

    return params;
}

class TranscribeWorker : public Napi::AsyncProgressQueueWorker<int> {
   public:
    TranscribeWorker(whisper_context* context, const float* samples, int n_samples,
                     struct whisper_full_params             params,
                     struct smart_whisper_transcribe_params smart_params,
                     Napi::Function& finish_callback, Napi::Function& progress_callback)
        : AsyncProgressQueueWorker(finish_callback),
          context(context),
          samples(samples),
          n_samples(n_samples),
          params(params),
          smart_params(smart_params) {
        this->progress_callback.Reset(progress_callback, 1);
        state = nullptr;
    }

    ~TranscribeWorker() {
        delete[] samples;
        // whisper_free_params(&params); will lead to a double free
        if (params.initial_prompt != nullptr) {
            free((void*)params.initial_prompt);
        }
        if (params.language != nullptr) {
            free((void*)params.language);
        }
        if (state != nullptr) {
            whisper_free_state(state);
        }

        free((void*)smart_params.format);
    }

    void Execute(const ExecutionProgress& progress) override {
        state = whisper_init_state(context);

        params.new_segment_callback = [](struct whisper_context* ctx, struct whisper_state* state,
                                         int n_new, void* user_data) {
            const ExecutionProgress& progress = *(ExecutionProgress*)user_data;

            const int i = whisper_full_n_segments_from_state(state) - 1;
            progress.Send(&i, 1);
        };
        params.new_segment_callback_user_data = (void*)&progress;

        int err = whisper_full_with_state(context, state, params, samples, n_samples);
        if (err != 0) {
            SetError("whisper_full operation failed");
        }
    }

    void OnProgress(const int* data, size_t _count) override {
        Napi::HandleScope scope(Env());

        if (this->progress_callback.IsEmpty()) {
            return;
        }

        int i = (*data);

        Napi::Object segment = Napi::Object::New(Env());
        segment.Set("from", Napi::Number::New(
                                Env(), whisper_full_get_segment_t0_from_state(state, i) * 10));
        segment.Set(
            "to", Napi::Number::New(Env(), whisper_full_get_segment_t1_from_state(state, i) * 10));
        segment.Set("text",
                    Napi::String::New(Env(), whisper_full_get_segment_text_from_state(state, i)));

        if (strcmp(smart_params.format, "detail") == 0) {
            float       confidence = 0, min_p = 1, max_p = 0;
            int         skips = 0;
            int         tokens = whisper_full_n_tokens_from_state(state, i);
            Napi::Array tokens_array = Napi::Array::New(Env(), tokens);
            for (int j = 0; j < tokens; j++) {
                auto         token = whisper_full_get_token_data_from_state(state, i, j);
                Napi::Object token_object = Napi::Object::New(Env());
                token_object.Set("text",
                                 Napi::String::New(Env(), whisper_full_get_token_text_from_state(
                                                              context, state, i, j)));
                token_object.Set("id", Napi::Number::New(Env(), token.id));
                token_object.Set("p", Napi::Number::New(Env(), token.p));
                tokens_array.Set(j, token_object);

                if (token.id > whisper_token_eot(context)) {
                    skips++;
                    continue;
                }
                confidence += token.p;
                min_p = std::min(min_p, token.p);
                max_p = std::max(max_p, token.p);
            }

            if (tokens > 2) {
                confidence = (confidence - min_p - max_p) / (tokens - 2 - skips);
            } else {
                confidence = confidence / (tokens - skips);
            }

            segment.Set(
                "lang",
                Napi::String::New(Env(), whisper_lang_str(whisper_full_lang_id_from_state(state))));
            segment.Set("confidence", Napi::Number::New(Env(), confidence));
            segment.Set("tokens", tokens_array);
        }

        this->progress_callback.Call({segment});
    }

    void OnOK() override {
        Napi::HandleScope scope(Env());

        int         n_segments = whisper_full_n_segments_from_state(state);
        Napi::Array segments = Napi::Array::New(Env(), n_segments);
        for (int i = 0; i < n_segments; i++) {
            Napi::Object segment = Napi::Object::New(Env());
            segment.Set("from", Napi::Number::New(
                                    Env(), whisper_full_get_segment_t0_from_state(state, i) * 10));
            segment.Set("to", Napi::Number::New(
                                  Env(), whisper_full_get_segment_t1_from_state(state, i) * 10));
            segment.Set("text", Napi::String::New(
                                    Env(), whisper_full_get_segment_text_from_state(state, i)));

            if (strcmp(smart_params.format, "detail") == 0) {
                float       confidence = 0, min_p = 1, max_p = 0;
                int         skips = 0;
                int         tokens = whisper_full_n_tokens_from_state(state, i);
                Napi::Array tokens_array = Napi::Array::New(Env(), tokens);
                for (int j = 0; j < tokens; j++) {
                    auto         token = whisper_full_get_token_data_from_state(state, i, j);
                    Napi::Object token_object = Napi::Object::New(Env());
                    token_object.Set(
                        "text", Napi::String::New(Env(), whisper_full_get_token_text_from_state(
                                                             context, state, i, j)));
                    token_object.Set("id", Napi::Number::New(Env(), token.id));
                    token_object.Set("p", Napi::Number::New(Env(), token.p));
                    if (params.token_timestamps) {
                        token_object.Set("from", Napi::Number::New(Env(), token.t0 * 10));
                        token_object.Set("to", Napi::Number::New(Env(), token.t1 * 10));
                    }

                    tokens_array.Set(j, token_object);

                    if (token.id > whisper_token_eot(context)) {
                        skips++;
                        continue;
                    }
                    confidence += token.p;
                    min_p = std::min(min_p, token.p);
                    max_p = std::max(max_p, token.p);
                }

                if (tokens - skips > 2) {
                    confidence = (confidence - min_p - max_p) / (tokens - skips - 2);
                } else if (tokens - skips > 0) {
                    confidence = confidence / (tokens - skips);
                }

                segment.Set("lang",
                            Napi::String::New(
                                Env(), whisper_lang_str(whisper_full_lang_id_from_state(state))));
                segment.Set("confidence", Napi::Number::New(Env(), confidence));
                segment.Set("tokens", tokens_array);
            }

            segments.Set(i, segment);
        }

        Callback().Call({segments});
    }

   private:
    whisper_context*                       context;
    whisper_state*                         state;
    const float*                           samples;
    int                                    n_samples;
    struct whisper_full_params             params;
    struct smart_whisper_transcribe_params smart_params;
    Napi::FunctionReference                progress_callback;
};

Napi::Value Transcribe(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() != 5) {
        Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
        return env.Null();
    }

    whisper_context* context = info[0].As<Napi::External<whisper_context>>().Data();

    Napi::Float32Array pcm = info[1].As<Napi::Float32Array>();
    float*             samples = new float[pcm.ElementLength()];
    memcpy(samples, pcm.Data(), pcm.ByteLength());

    int n_samples = static_cast<int>(pcm.ElementLength());

    Napi::Object params = info[2].As<Napi::Object>();
    auto         whisper_params = whisper_full_params_from_js(params);
    auto         smart_params = smart_whisper_transcribe_params_from_js(params);

    Napi::Function finish_callback = info[3].As<Napi::Function>();
    Napi::Function progress_callback = info[4].As<Napi::Function>();

    auto worker = new TranscribeWorker(context, samples, n_samples, whisper_params, smart_params,
                                       finish_callback, progress_callback);
    worker->Queue();

    return env.Undefined();
}
