#ifndef _GUARD_SW_MODEL_H
#define _GUARD_SW_MODEL_H

#include "common.h"
#include "whisper.h"

class WhisperModel : public Napi::ObjectWrap<WhisperModel> {
   public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);

    WhisperModel(const Napi::CallbackInfo &info);
    void Finalize(Napi::Env env);

   private:
    whisper_context   *context;
    static Napi::Value Load(const Napi::CallbackInfo &info);
    Napi::Value        Free(const Napi::CallbackInfo &info);
    Napi::Value        GetFreed(const Napi::CallbackInfo &info);
    Napi::Value        GetHandle(const Napi::CallbackInfo &info);
};

#endif
