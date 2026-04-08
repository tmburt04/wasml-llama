cmake_minimum_required(VERSION 3.20)
project(wasml-llama-overlay C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})

set(WASML_LLAMA_VENDOR_DIR "" CACHE PATH "Path to upstream llama.cpp checkout")
set(WASML_LLAMA_OUTPUT_NAME "wasml-llama" CACHE STRING "Output module name")

if(NOT WASML_LLAMA_VENDOR_DIR)
  message(FATAL_ERROR "WASML_LLAMA_VENDOR_DIR is required")
endif()

add_subdirectory(${WASML_LLAMA_VENDOR_DIR} vendor-llama)

add_executable(wasml_llama_module src/wasml_llama_bridge.cpp)
target_link_libraries(wasml_llama_module PRIVATE llama)
target_include_directories(wasml_llama_module PRIVATE ${WASML_LLAMA_VENDOR_DIR}/include)
set_target_properties(wasml_llama_module PROPERTIES OUTPUT_NAME ${WASML_LLAMA_OUTPUT_NAME})

if(EMSCRIPTEN)
  set(EXPORTS_FILE ${CMAKE_CURRENT_LIST_DIR}/../llama-wasm.exports.json)
  if(LLAMA_WASM_MEM64)
    target_compile_options(wasml_llama_module PRIVATE "-sMEMORY64=1")
    target_link_options(wasml_llama_module PRIVATE "-sMEMORY64=1")
  endif()
  # Keep this list aligned with runtime-core/src/emscripten-adapter.ts string
  # marshalling helpers and the ABI contract in upstream-sync/abi/contract.json.
  target_link_options(wasml_llama_module PRIVATE
    "SHELL:-sEXPORTED_FUNCTIONS=@${EXPORTS_FILE}"
    "SHELL:-sEXPORTED_RUNTIME_METHODS=['cwrap','ccall','FS','UTF8ToString','stringToUTF8','lengthBytesUTF8']"
    "-sFORCE_FILESYSTEM=1"
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
  )
endif()
