{
  'variables' : {
    'openssl_fips': '',
  },
  "targets": [
    {
      "target_name": "smart-whisper",
      "sources": [
          "src/binding/binding.cc",
          "src/binding/common.cc",
          "src/binding/model.cc",
          "src/binding/transcribe.cc",
          "<!@(node -p \"require('./dist/build.js').sources\")"
      ],
      "libraries": [ "<!@(node -p \"require('./dist/build.js').libraries\")" ],
      'defines': [ "<!@(node -p \"require('./dist/build.js').defines\")" ],
      'include_dirs': ["<!@(node -p \"require('node-addon-api').include\")", "whisper.cpp/include", "whisper.cpp/ggml/include", "whisper.cpp/examples"],
      'dependencies': ["<!(node -p \"require('node-addon-api').gyp\")"],
      'cflags!': [ '-fno-exceptions' ],
      'cflags_cc!': [ '-fno-exceptions' ],
      'xcode_settings': {
        'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
        'CLANG_CXX_LIBRARY': 'libc++',
      },
      'msvs_settings': {
        'VCCLCompilerTool': { 'ExceptionHandling': 1 },
      },
      'conditions': [
        ['OS=="mac"', {
            'xcode_settings': {
                'GCC_SYMBOLS_PRIVATE_EXTERN': 'YES', # -fvisibility=hidden
            }
        }]
      ]
    }
  ],
}
