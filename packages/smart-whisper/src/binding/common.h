#ifndef _GUARD_SW_COMMON_H
#define _GUARD_SW_COMMON_H

#ifndef NAPI_VERSION
// Support Node.js 16+
#define NAPI_VERSION 8
#endif
#include <napi.h>

class PromiseWorker : public Napi::AsyncWorker {
   public:
    PromiseWorker(Napi::Env &env) : AsyncWorker(env), promise(Napi::Promise::Deferred::New(env)) {}

    Napi::Promise Promise();

   protected:
    Napi::Promise::Deferred promise;
};

bool IsProduction(const Napi::Object global_env);

#endif
