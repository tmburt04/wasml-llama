#include <algorithm>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include "llama.h"

namespace {

struct bridge_state {
    llama_model * model = nullptr;
    llama_context * ctx = nullptr;
    llama_sampler * sampler = nullptr;
    const llama_vocab * vocab = nullptr;
    std::string last_error;
    std::string generated_text;
    std::string last_token_text;
    llama_token last_token = LLAMA_TOKEN_NULL;
    int32_t generated_token_count = 0;
    bool last_token_is_eog = false;
    bool backend_ready = false;
    std::vector<char> piece_buf;
    std::vector<llama_token> single_token_buf;
} g_state;

void clear_error() {
    g_state.last_error.clear();
}

int fail(const std::string & message) {
    g_state.last_error = message;
    return -1;
}

void free_sampler() {
    if (g_state.sampler != nullptr) {
        llama_sampler_free(g_state.sampler);
        g_state.sampler = nullptr;
    }
}

void reset_generation_state() {
    free_sampler();
    g_state.last_token = LLAMA_TOKEN_NULL;
    g_state.generated_token_count = 0;
    g_state.generated_text.clear();
    g_state.last_token_is_eog = false;
    g_state.last_token_text.clear();
    if (g_state.ctx != nullptr) {
        llama_memory_clear(llama_get_memory(g_state.ctx), true);
    }
}

void unload_model_internal() {
    reset_generation_state();
    if (g_state.ctx != nullptr) {
        llama_free(g_state.ctx);
        g_state.ctx = nullptr;
    }
    if (g_state.model != nullptr) {
        llama_model_free(g_state.model);
        g_state.model = nullptr;
    }
    g_state.vocab = nullptr;
}

void token_to_text_fast(llama_token token, std::string & out) {
    if (g_state.vocab == nullptr) {
        out.clear();
        return;
    }
    if (g_state.piece_buf.size() < 32) {
        g_state.piece_buf.resize(32, '\0');
    }
    int32_t written = llama_token_to_piece(g_state.vocab, token,
        g_state.piece_buf.data(), static_cast<int32_t>(g_state.piece_buf.size()), 0, true);
    if (written < 0) {
        g_state.piece_buf.resize(static_cast<size_t>(-written) + 1U, '\0');
        written = llama_token_to_piece(g_state.vocab, token,
            g_state.piece_buf.data(), static_cast<int32_t>(g_state.piece_buf.size()), 0, true);
    }
    if (written <= 0) {
        out.clear();
        return;
    }
    out.assign(g_state.piece_buf.data(), static_cast<size_t>(written));
}

int decode_single_token(llama_token token) {
    g_state.single_token_buf.resize(1);
    g_state.single_token_buf[0] = token;
    llama_batch batch = llama_batch_get_one(g_state.single_token_buf.data(), 1);
    return llama_decode(g_state.ctx, batch);
}

int decode_tokens(llama_token * tokens, int32_t count) {
    if (count <= 0) {
        return 0;
    }
    llama_batch batch = llama_batch_get_one(tokens, count);
    return llama_decode(g_state.ctx, batch);
}

}

extern "C" {
int wasml_backend_init() {
    clear_error();
    if (!g_state.backend_ready) {
        llama_backend_init();
        g_state.backend_ready = true;
    }
    return 0;
}

void wasml_backend_free() {
    unload_model_internal();
    if (g_state.backend_ready) {
        llama_backend_free();
        g_state.backend_ready = false;
    }
}

int wasml_load_model(const char * path_model, int32_t n_ctx, int32_t n_gpu_layers, int32_t use_gpu, int32_t warmup) {
    clear_error();
    if (path_model == nullptr || path_model[0] == '\0') {
        return fail("model path missing");
    }
    if (wasml_backend_init() != 0) {
        return -1;
    }
    unload_model_internal();

    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = use_gpu != 0 ? n_gpu_layers : 0;
    model_params.main_gpu = 0;

    g_state.model = llama_model_load_from_file(path_model, model_params);
    if (g_state.model == nullptr) {
        return fail("failed to load model");
    }

    const uint32_t ctx_size = n_ctx > 0 ? static_cast<uint32_t>(n_ctx) : 2048U;

    llama_context_params context_params = llama_context_default_params();
    context_params.n_ctx = ctx_size;
    context_params.n_batch = std::max<uint32_t>(512U, std::min<uint32_t>(ctx_size, 4096U));
    context_params.n_ubatch = std::min<uint32_t>(context_params.n_batch, 512U);
    context_params.offload_kqv = use_gpu != 0;
    context_params.op_offload = use_gpu != 0;
    context_params.flash_attn_type = use_gpu != 0 ? LLAMA_FLASH_ATTN_TYPE_AUTO : LLAMA_FLASH_ATTN_TYPE_DISABLED;
    context_params.no_perf = true;

    g_state.ctx = llama_init_from_model(g_state.model, context_params);
    if (g_state.ctx == nullptr) {
        llama_model_free(g_state.model);
        g_state.model = nullptr;
        return fail("failed to initialize context");
    }

    g_state.vocab = llama_model_get_vocab(g_state.model);

    if (warmup != 0) {
        llama_set_warmup(g_state.ctx, true);
    }

    g_state.piece_buf.reserve(64);
    g_state.single_token_buf.reserve(1);
    g_state.generated_text.reserve(4096);

    return 0;
}

void wasml_unload_model() {
    unload_model_internal();
    clear_error();
}

void wasml_reset_state() {
    clear_error();
    reset_generation_state();
}

int wasml_begin_inference(const char * prompt, int32_t add_special, int32_t top_k, float top_p, float temp, uint32_t seed) {
    clear_error();
    if (g_state.ctx == nullptr || g_state.model == nullptr || g_state.vocab == nullptr) {
        return fail("model not loaded");
    }

    reset_generation_state();

    const char * prompt_text = prompt != nullptr ? prompt : "";
    const int32_t prompt_len = static_cast<int32_t>(std::strlen(prompt_text));
    std::vector<llama_token> prompt_tokens(static_cast<size_t>(prompt_len) + 512U);
    int32_t token_count = llama_tokenize(g_state.vocab, prompt_text, prompt_len, prompt_tokens.data(), static_cast<int32_t>(prompt_tokens.size()), add_special != 0, false);
    if (token_count < 0) {
        prompt_tokens.resize(static_cast<size_t>(-token_count));
        token_count = llama_tokenize(g_state.vocab, prompt_text, prompt_len, prompt_tokens.data(), static_cast<int32_t>(prompt_tokens.size()), add_special != 0, false);
    }
    if (token_count <= 0) {
        return fail("failed to tokenize prompt");
    }
    prompt_tokens.resize(static_cast<size_t>(token_count));

    if (decode_tokens(prompt_tokens.data(), token_count) != 0) {
        return fail("failed to decode prompt");
    }

    llama_sampler_chain_params sampler_params = llama_sampler_chain_default_params();
    g_state.sampler = llama_sampler_chain_init(sampler_params);
    if (g_state.sampler == nullptr) {
        return fail("failed to initialize sampler");
    }
    if (top_k > 0) {
        llama_sampler_chain_add(g_state.sampler, llama_sampler_init_top_k(top_k));
    }
    if (top_p > 0.0f && top_p < 1.0f) {
        llama_sampler_chain_add(g_state.sampler, llama_sampler_init_top_p(top_p, 1));
    }
    if (temp > 0.0f) {
        llama_sampler_chain_add(g_state.sampler, llama_sampler_init_temp(temp));
        llama_sampler_chain_add(g_state.sampler, llama_sampler_init_dist(seed));
    } else {
        llama_sampler_chain_add(g_state.sampler, llama_sampler_init_greedy());
    }
    return 0;
}

int wasml_generate_all(int32_t max_tokens) {
    clear_error();
    if (g_state.ctx == nullptr || g_state.sampler == nullptr || g_state.vocab == nullptr) {
        return fail("inference not initialized");
    }

    g_state.generated_text.clear();
    g_state.generated_token_count = 0;

    for (int32_t i = 0; i < max_tokens; ++i) {
        const llama_token token = llama_sampler_sample(g_state.sampler, g_state.ctx, -1);

        if (llama_vocab_is_eog(g_state.vocab, token)) {
            g_state.last_token = token;
            g_state.last_token_is_eog = true;
            return g_state.generated_token_count;
        }

        token_to_text_fast(token, g_state.last_token_text);
        g_state.generated_text += g_state.last_token_text;
        g_state.generated_token_count += 1;
        g_state.last_token = token;
        g_state.last_token_is_eog = false;

        if (decode_single_token(token) != 0) {
            return fail("failed to decode sampled token");
        }
    }

    return g_state.generated_token_count;
}

int wasml_step_inference() {
    clear_error();
    if (g_state.ctx == nullptr || g_state.sampler == nullptr || g_state.vocab == nullptr) {
        return fail("inference not initialized");
    }

    const llama_token token = llama_sampler_sample(g_state.sampler, g_state.ctx, -1);
    g_state.last_token = token;
    g_state.last_token_is_eog = llama_vocab_is_eog(g_state.vocab, token);
    token_to_text_fast(token, g_state.last_token_text);

    g_state.generated_text.clear();
    g_state.generated_text = g_state.last_token_text;
    g_state.generated_token_count = g_state.last_token_is_eog ? 0 : 1;

    if (g_state.last_token_is_eog) {
        return 1;
    }

    if (decode_single_token(token) != 0) {
        return fail("failed to decode sampled token");
    }
    return 0;
}

int wasml_step_inference_many(int32_t max_tokens) {
    if (max_tokens <= 1) {
        return wasml_step_inference();
    }
    clear_error();
    if (g_state.ctx == nullptr || g_state.sampler == nullptr || g_state.vocab == nullptr) {
        return fail("inference not initialized");
    }

    g_state.generated_text.clear();
    g_state.generated_token_count = 0;

    for (int32_t i = 0; i < max_tokens; ++i) {
        const llama_token token = llama_sampler_sample(g_state.sampler, g_state.ctx, -1);
        g_state.last_token = token;
        g_state.last_token_is_eog = llama_vocab_is_eog(g_state.vocab, token);
        token_to_text_fast(token, g_state.last_token_text);

        if (g_state.last_token_is_eog) {
            return 1;
        }

        g_state.generated_text += g_state.last_token_text;
        g_state.generated_token_count += 1;

        if (decode_single_token(token) != 0) {
            return fail("failed to decode sampled token");
        }
    }

    return 0;
}

const char * wasml_last_chunk_text() {
    return g_state.generated_text.c_str();
}

int32_t wasml_last_chunk_token_count() {
    return g_state.generated_token_count;
}

const char * wasml_last_token_text() {
    return g_state.last_token_text.c_str();
}

int32_t wasml_last_token_id() {
    return g_state.last_token;
}

int32_t wasml_last_token_is_eog() {
    return g_state.last_token_is_eog ? 1 : 0;
}

const char * wasml_last_error() {
    return g_state.last_error.c_str();
}

int64_t wasml_model_size() {
    return g_state.model != nullptr ? static_cast<int64_t>(llama_model_size(g_state.model)) : 0;
}

int64_t wasml_model_n_params() {
    return g_state.model != nullptr ? static_cast<int64_t>(llama_model_n_params(g_state.model)) : 0;
}

int32_t wasml_supports_gpu_offload() {
    return llama_supports_gpu_offload() ? 1 : 0;
}
}
