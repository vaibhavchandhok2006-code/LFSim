#ifndef FREERTOS_H
#define FREERTOS_H
#include <stdint.h>
#include "sdkconfig.h"
#include "esp_err.h"
#include "esp_attr.h"
typedef uint32_t TickType_t;
typedef int BaseType_t;
typedef unsigned int UBaseType_t;
#define configTICK_RATE_HZ CONFIG_FREERTOS_HZ
#define portTICK_PERIOD_MS ((TickType_t)1000 / configTICK_RATE_HZ)
#define pdMS_TO_TICKS(ms) ((TickType_t)(((uint64_t)(ms) * configTICK_RATE_HZ) / 1000))
#define pdTICKS_TO_MS(t) ((uint32_t)(((uint64_t)(t) * 1000) / configTICK_RATE_HZ))
#define pdTRUE 1
#define pdFALSE 0
#define pdPASS 1
#define pdFAIL 0
#define portMAX_DELAY ((TickType_t)0xffffffffUL)
#define portYIELD_FROM_ISR(x) ((void)(x))
#endif
