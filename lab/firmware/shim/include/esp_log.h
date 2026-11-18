#ifndef ESP_LOG_H
#define ESP_LOG_H
#include "lfsim_api.h"
#define ESP_LOGE(tag, fmt, ...) lfsim_log('E', tag, fmt, ##__VA_ARGS__)
#define ESP_LOGW(tag, fmt, ...) lfsim_log('W', tag, fmt, ##__VA_ARGS__)
#define ESP_LOGI(tag, fmt, ...) lfsim_log('I', tag, fmt, ##__VA_ARGS__)
/* Debug and verbose logs are off at the default log level (INFO), as on the chip. */
#define ESP_LOGD(tag, fmt, ...) do { } while (0)
#define ESP_LOGV(tag, fmt, ...) do { } while (0)
#define ESP_EARLY_LOGE ESP_LOGE
#define ESP_EARLY_LOGW ESP_LOGW
#define ESP_EARLY_LOGI ESP_LOGI
typedef enum { ESP_LOG_NONE, ESP_LOG_ERROR, ESP_LOG_WARN, ESP_LOG_INFO, ESP_LOG_DEBUG, ESP_LOG_VERBOSE } esp_log_level_t;
static inline void esp_log_level_set(const char *tag, esp_log_level_t level) { (void)tag; (void)level; }
#endif
