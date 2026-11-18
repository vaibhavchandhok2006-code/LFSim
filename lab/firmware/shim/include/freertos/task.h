#ifndef FREERTOS_TASK_H
#define FREERTOS_TASK_H
#include "freertos/FreeRTOS.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef void *TaskHandle_t;
void vTaskDelay(TickType_t ticks);
TickType_t xTaskGetTickCount(void);
void taskYIELD(void);
void vTaskDelete(TaskHandle_t t);
/* Tasks other than app_main are not simulated (the simulated chip runs one thread). */
BaseType_t xTaskCreate(void (*fn)(void *), const char *name, uint32_t stack, void *arg, UBaseType_t prio, TaskHandle_t *out);
BaseType_t xTaskCreatePinnedToCore(void (*fn)(void *), const char *name, uint32_t stack, void *arg, UBaseType_t prio, TaskHandle_t *out, BaseType_t core);
#ifdef __cplusplus
}
#endif
#endif
