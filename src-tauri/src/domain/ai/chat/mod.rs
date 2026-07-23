mod builtin_gateway;
mod gateway_sign;
mod config;
mod list_models;
mod message_builder;
mod retry;
mod send;
mod stream;
mod test_connection;
mod types;
mod web_fetch;
mod web_search;

pub use types::{ChatImageAttachment, ChatMessage, ChatTaskMap, ToolCall, ToolCallFunction};

pub use config::{
    __cmd__get_app_data_path, __cmd__get_prompts_config_path, __cmd__load_ai_config, __cmd__load_prompts,
    __cmd__save_ai_config, __cmd__save_prompts, get_app_data_path, get_prompts_config_path, load_ai_config,
    load_ai_config_json, load_prompts, save_ai_config, save_prompts,
};

pub use test_connection::{__cmd__test_ai_connection, test_ai_connection};

pub use list_models::{__cmd__list_ai_models, list_ai_models};

pub use builtin_gateway::{
    __cmd__builtin_gateway_activate, __cmd__builtin_gateway_get_quota,
    __cmd__builtin_gateway_health, __cmd__builtin_gateway_list_models, builtin_gateway_activate,
    builtin_gateway_get_quota, builtin_gateway_health, builtin_gateway_list_models,
};

pub use message_builder::{
    extension_from_image_format, media_type_from_image_format, normalize_path_string,
};

pub use send::{
    __cmd__cancel_ai_chat, __cmd__generate_compact_summary, __cmd__generate_conversation_title,
    cancel_ai_chat, generate_compact_summary, generate_conversation_title,
};

pub use stream::{__cmd__send_ai_chat_stream, send_ai_chat_stream};

pub use web_fetch::{
    __cmd__fetch_web_content_v3,
    fetch_web_content_v3,
};

pub use web_search::{
    __cmd__web_search,
    format_search_output,
    web_search,
};

// Suppress unused import warning for legacy compatibility
#[allow(unused_imports)]
pub use config::get_ai_config_path;

// Suppress dead code warning for legacy compatibility  
pub use config::openai_images_generations_urls;
