cmake_minimum_required(VERSION 3.20)
project(whisper_node LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

add_definitions(-DNAPI_VERSION=8)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/../whisper.cpp/cmake")

set(WHISPER_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../whisper.cpp")

set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(WHISPER_CURL OFF CACHE BOOL "" FORCE)
set(WHISPER_SDL2 OFF CACHE BOOL "" FORCE)
set(WHISPER_FFMPEG OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(GGML_STATIC ON CACHE BOOL "" FORCE)
set(GGML_SHARED OFF CACHE BOOL "" FORCE)

add_subdirectory(${WHISPER_CPP_DIR} whispercpp EXCLUDE_FROM_ALL)

find_package(Threads REQUIRED)

set(ADDON_SOURCES
  ${CMAKE_CURRENT_SOURCE_DIR}/addon.cpp
  ${WHISPER_CPP_DIR}/examples/common.cpp
  ${WHISPER_CPP_DIR}/examples/common-ggml.cpp
  ${WHISPER_CPP_DIR}/examples/common-whisper.cpp
  ${WHISPER_CPP_DIR}/examples/grammar-parser.cpp
)

add_library(whisper_node SHARED ${ADDON_SOURCES})
set_target_properties(whisper_node PROPERTIES PREFIX "" SUFFIX ".node" OUTPUT_NAME "whisper")

if (CMAKE_CXX_COMPILER_ID MATCHES "Clang" OR CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
  target_compile_options(whisper_node PRIVATE -Wall -Wextra -Wno-unused-parameter)
endif()

set_target_properties(whisper_node PROPERTIES
  CXX_VISIBILITY_PRESET hidden
  VISIBILITY_INLINES_HIDDEN ON)

# CMake-js variables
if (DEFINED CMAKE_JS_INC)
  string(REPLACE ";" " " TMP_CMAKE_JS_INC "${CMAKE_JS_INC}")
endif()
if (DEFINED CMAKE_JS_LIB)
  string(REPLACE ";" " " TMP_CMAKE_JS_LIB "${CMAKE_JS_LIB}")
endif()

if (DEFINED TMP_CMAKE_JS_INC)
  separate_arguments(TMP_CMAKE_JS_INC)
  foreach(INC ${TMP_CMAKE_JS_INC})
    target_include_directories(whisper_node PRIVATE "${INC}")
  endforeach()
endif()

if (DEFINED TMP_CMAKE_JS_LIB)
  separate_arguments(TMP_CMAKE_JS_LIB)
endif()

# Include directories
target_include_directories(whisper_node PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${WHISPER_CPP_DIR}/include
  ${WHISPER_CPP_DIR}/ggml/include
  ${WHISPER_CPP_DIR}/examples
)

# Link libraries
if (DEFINED TMP_CMAKE_JS_LIB)
  target_link_libraries(whisper_node PRIVATE ${TMP_CMAKE_JS_LIB})
endif()

target_link_libraries(whisper_node PRIVATE whisper Threads::Threads)

# On macOS we need to allow undefined symbols for node addon
if (APPLE)
  target_link_options(whisper_node PRIVATE "-undefined" "dynamic_lookup")
endif()
