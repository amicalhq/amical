#ifndef _GUARD_SW_TRANSCRIBE_H
#define _GUARD_SW_TRANSCRIBE_H

#include "common.h"
#include "whisper.h"

Napi::Value Transcribe(const Napi::CallbackInfo& info);

#endif
