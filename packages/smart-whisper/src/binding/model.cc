#include "model.h"

class LoadModelWorker : public PromiseWorker {
   public:
    LoadModelWorker(Napi::Env &env, const std::string &model_path,
                    struct whisper_context_params params)
        : PromiseWorker(env), model_path(model_path), params(params) {}

    void Execute() override {
        context = whisper_init_from_file_with_params_no_state(model_path.c_str(), params);
        if (context == nullptr) {
            SetError("Failed to initialize whisper context");
        }
        whisper_print_timings(context);
    }

    void OnOK() override {
        Napi::HandleScope scope(Env());
        auto              handle = Napi::External<whisper_context>::New(Env(), context);
        auto              constructor = Env().GetInstanceData<Napi::FunctionReference>();
        auto              model = constructor->New({handle});

        promise.Resolve(model);
    }

   private:
    std::string                   model_path;
    struct whisper_context_params params;
    whisper_context              *context;
};

class FreeModelWorker : public PromiseWorker {
   public:
    FreeModelWorker(Napi::Env &env, whisper_context *context)
        : PromiseWorker(env), context(context) {}

    void Execute() override { whisper_free(context); }

    void OnOK() override {
        Napi::HandleScope scope(Env());
        promise.Resolve(Env().Undefined());
    }

   private:
    whisper_context *context;
};

Napi::Object WhisperModel::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(
        env, "WhisperModel",
        {
            StaticMethod<&WhisperModel::Load>(
                "load", static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
            InstanceMethod<&WhisperModel::Free>(
                "free", static_cast<napi_property_attributes>(napi_writable | napi_configurable)),
            InstanceAccessor(
                "freed", &WhisperModel::GetFreed, nullptr,
                static_cast<napi_property_attributes>(napi_enumerable | napi_configurable)),
            InstanceAccessor(
                "handle", &WhisperModel::GetHandle, nullptr,
                static_cast<napi_property_attributes>(napi_enumerable | napi_configurable)),
        });

    auto constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    env.SetInstanceData<Napi::FunctionReference>(constructor);

    exports.Set("WhisperModel", func);
    return exports;
}

WhisperModel::WhisperModel(const Napi::CallbackInfo &info) : Napi::ObjectWrap<WhisperModel>(info) {
    Napi::Env         env = info.Env();
    Napi::HandleScope scope(env);

    if (info.Length() != 1) {
        Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
        return;
    }

    whisper_context *context = info[0].As<Napi::External<whisper_context>>().Data();
    this->context = context;
}

void WhisperModel::Finalize(Napi::Env env) {
    if (context != nullptr) {
        whisper_free(context);
        context = nullptr;
    }
}

Napi::Value WhisperModel::Load(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || info.Length() > 2) {
        Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string model_path = info[0].As<Napi::String>();

    whisper_context_params params;
    params.use_gpu = info.Length() == 2 ? info[1].As<Napi::Boolean>() : true;

    auto worker = new LoadModelWorker(env, model_path, params);
    worker->Queue();

    return worker->Promise();
}

Napi::Value WhisperModel::Free(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();

    if (info.Length() != 0) {
        Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (context == nullptr) {
        auto deferred = Napi::Promise::Deferred::New(env);
        deferred.Resolve(env.Undefined());
        return deferred.Promise();
    } else {
        auto worker = new FreeModelWorker(env, context);
        context = nullptr;
        worker->Queue();
        return worker->Promise();
    }
}

Napi::Value WhisperModel::GetFreed(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();

    return Napi::Boolean::New(env, context == nullptr);
}

Napi::Value WhisperModel::GetHandle(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();

    if (context == nullptr) {
        return env.Null();
    }

    return Napi::External<whisper_context>::New(env, context);
}
