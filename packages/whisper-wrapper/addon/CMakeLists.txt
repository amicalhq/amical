cmake_minimum_required(VERSION 3.20)
project(whisper_node LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

if (APPLE AND NOT CMAKE_OSX_DEPLOYMENT_TARGET)
  set(CMAKE_OSX_DEPLOYMENT_TARGET "14.0" CACHE STRING "Minimum macOS version" FORCE)
endif()

add_definitions(-DNAPI_VERSION=8)

# CUDA 13.x CCCL requires MSVC's conformant preprocessor — whisper.cpp does not
# enable it by default, so set it here before pulling in the whisper.cpp subtree.
if (MSVC)
  add_compile_options(
    "$<$<COMPILE_LANGUAGE:C,CXX>:/Zc:preprocessor>"
    "$<$<COMPILE_LANGUAGE:CUDA>:-Xcompiler=/Zc:preprocessor>"
  )
endif()

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

# CMake-js variables — CMAKE_JS_INC / CMAKE_JS_LIB are already semicolon-
# delimited CMake lists. Iterate them directly; the previous REPLACE+
# separate_arguments approach broke paths that contain spaces.
if (DEFINED CMAKE_JS_INC)
  foreach(INC IN LISTS CMAKE_JS_INC)
    target_include_directories(whisper_node PRIVATE "${INC}")
  endforeach()
endif()

# Include directories
target_include_directories(whisper_node PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${WHISPER_CPP_DIR}/include
  ${WHISPER_CPP_DIR}/ggml/include
  ${WHISPER_CPP_DIR}/examples
)

# Link libraries
if (DEFINED CMAKE_JS_LIB)
  target_link_libraries(whisper_node PRIVATE ${CMAKE_JS_LIB})
endif()

target_link_libraries(whisper_node PRIVATE whisper Threads::Threads)

# On macOS we need to allow undefined symbols for node addon
if (APPLE)
  target_link_options(whisper_node PRIVATE "-undefined" "dynamic_lookup")
endif()
