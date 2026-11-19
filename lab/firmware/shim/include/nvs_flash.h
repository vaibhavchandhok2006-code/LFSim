/* LFSim shim: ESP-IDF nvs_flash.h. Flash is simulated; it keeps its contents between the runs of a session. */
#ifndef NVS_FLASH_H
#define NVS_FLASH_H
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
esp_err_t nvs_flash_init(void);
esp_err_t nvs_flash_erase(void);
esp_err_t nvs_flash_deinit(void);
#ifdef __cplusplus
}
#endif
#endif
