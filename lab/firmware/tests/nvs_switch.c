/* Test firmware: counts power-ups in flash (NVS), keeps a route blob and a name string, reads a switch on GPIO 27. */
#include <stdio.h>
#include <string.h>
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs.h"
#include "nvs_flash.h"

void app_main(void) {
  ESP_ERROR_CHECK(nvs_flash_init());
  nvs_handle_t h;
  ESP_ERROR_CHECK(nvs_open("maze", NVS_READWRITE, &h));
  int32_t runs = 0;
  esp_err_t e = nvs_get_i32(h, "runs", &runs);
  printf("get runs: %s %d\n", e == ESP_OK ? "ok" : e == ESP_ERR_NVS_NOT_FOUND ? "not-found" : "error", (int)runs);
  runs += 1;
  ESP_ERROR_CHECK(nvs_set_i32(h, "runs", runs));
  uint8_t route[8]; size_t n = sizeof route;
  if (nvs_get_blob(h, "route", route, &n) == ESP_OK) printf("route %u bytes: %c%c%c%c\n", (unsigned)n, route[0], route[1], route[2], route[3]);
  memcpy(route, "LSRB", 4);
  ESP_ERROR_CHECK(nvs_set_blob(h, "route", route, 4));
  size_t need = 0;
  if (nvs_get_str(h, "name", NULL, &need) == ESP_OK) { char buf[32]; size_t m = sizeof buf; nvs_get_str(h, "name", buf, &m); printf("name (%u): %s\n", (unsigned)need, buf); }
  ESP_ERROR_CHECK(nvs_set_str(h, "name", "rmi"));
  uint8_t small; printf("i32 read as u8: %s\n", nvs_get_u8(h, "runs", &small) == ESP_ERR_NVS_NOT_FOUND ? "not-found" : "found");
  printf("key too long: %s\n", nvs_set_u8(h, "a_very_long_key_name", 1) == ESP_ERR_NVS_KEY_TOO_LONG ? "rejected" : "accepted");
  ESP_ERROR_CHECK(nvs_commit(h));
  nvs_close(h);
  gpio_set_direction(27, GPIO_MODE_INPUT);
  printf("switch: %d\n", gpio_get_level(27));
  for (;;) vTaskDelay(10);
}
