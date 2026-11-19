#ifndef ESP_ERR_H
#define ESP_ERR_H
#include "lfsim_api.h"
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NO_MEM 0x101
#define ESP_ERR_INVALID_ARG 0x102
#define ESP_ERR_INVALID_STATE 0x103
#define ESP_ERR_NOT_FOUND 0x105
#define ESP_ERR_TIMEOUT 0x107
#define ESP_ERR_NVS_BASE 0x1100
#define ESP_ERR_NVS_NOT_INITIALIZED 0x1101
#define ESP_ERR_NVS_NOT_FOUND 0x1102
#define ESP_ERR_NVS_TYPE_MISMATCH 0x1103
#define ESP_ERR_NVS_READ_ONLY 0x1104
#define ESP_ERR_NVS_NOT_ENOUGH_SPACE 0x1105
#define ESP_ERR_NVS_INVALID_NAME 0x1106
#define ESP_ERR_NVS_INVALID_HANDLE 0x1107
#define ESP_ERR_NVS_KEY_TOO_LONG 0x1109
#define ESP_ERR_NVS_INVALID_LENGTH 0x110c
#define ESP_ERR_NVS_NO_FREE_PAGES 0x110d
#define ESP_ERR_NVS_VALUE_TOO_LONG 0x110e
#define ESP_ERR_NVS_NEW_VERSION_FOUND 0x1110
#define ESP_ERROR_CHECK(x) do { esp_err_t err_rc_ = (x); if (err_rc_ != ESP_OK) lfsim_fail("ESP_ERROR_CHECK failed: esp_err_t 0x%x at %s:%d (%s)", err_rc_, __FILE__, __LINE__, #x); } while (0)
#define ESP_ERROR_CHECK_WITHOUT_ABORT(x) (x)
static inline const char *esp_err_to_name(esp_err_t e) { return e == ESP_OK ? "ESP_OK" : "ESP_ERR"; }
#endif
