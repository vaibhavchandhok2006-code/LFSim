/* LFSim reference firmware (ESP-IDF C). A plain PD line follower with a left-hand rule at junctions and a U-turn at
 * dead ends, written once in C (this file) and once as its LFSim JavaScript translation (main.js) to prove that native
 * firmware and Code mode behave the same. Integer and double arithmetic only, so both give identical results.
 * Wiring: the RMI test rig (8 sensors on ADC1/ADC2, TB6612FNG). */
#include <stdio.h>
#include <stdbool.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "driver/gpio.h"
#include "driver/ledc.h"

static const char *TAG = "REF";
#define N 8
#define WHITE 300
#define BLACK 2600
#define AIN1 GPIO_NUM_17
#define AIN2 GPIO_NUM_18
#define BIN1 GPIO_NUM_13
#define BIN2 GPIO_NUM_22
#define STBY GPIO_NUM_23
#define PWMA GPIO_NUM_16
#define PWMB GPIO_NUM_19
#define BASE 620
#define KP 34.0
#define KD 260.0

/* index 0 = rightmost sensor (as on the rig): unit, channel */
static const int unit_of[N] = { 0, 0, 0, 0, 0, 0, 1, 1 };
static const adc_channel_t chan_of[N] = { ADC_CHANNEL_0, ADC_CHANNEL_3, ADC_CHANNEL_6, ADC_CHANNEL_7, ADC_CHANNEL_4, ADC_CHANNEL_5, ADC_CHANNEL_8, ADC_CHANNEL_9 };
static adc_oneshot_unit_handle_t units[2];

static void motors(int left, int right) {
  if (left > 1023) left = 1023;
  if (left < -1023) left = -1023;
  if (right > 1023) right = 1023;
  if (right < -1023) right = -1023;
  gpio_set_level(AIN1, left >= 0 ? 1 : 0);
  gpio_set_level(AIN2, left >= 0 ? 0 : 1);
  gpio_set_level(BIN1, right >= 0 ? 1 : 0);
  gpio_set_level(BIN2, right >= 0 ? 0 : 1);
  ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, left >= 0 ? left : -left);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
  ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1, right >= 0 ? right : -right);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_1);
}

void app_main(void) {
  for (int u = 0; u < 2; u++) {
    adc_oneshot_unit_init_cfg_t ucfg = { .unit_id = u == 0 ? ADC_UNIT_1 : ADC_UNIT_2 };
    adc_oneshot_new_unit(&ucfg, &units[u]);
  }
  adc_oneshot_chan_cfg_t ccfg = { .atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_12 };
  for (int i = 0; i < N; i++) adc_oneshot_config_channel(units[unit_of[i]], chan_of[i], &ccfg);
  gpio_config_t io = { .pin_bit_mask = (1ULL << AIN1) | (1ULL << AIN2) | (1ULL << BIN1) | (1ULL << BIN2) | (1ULL << STBY), .mode = GPIO_MODE_OUTPUT };
  gpio_config(&io);
  ledc_timer_config_t t = { .speed_mode = LEDC_LOW_SPEED_MODE, .duty_resolution = LEDC_TIMER_10_BIT, .timer_num = LEDC_TIMER_0, .freq_hz = 5000, .clk_cfg = LEDC_AUTO_CLK };
  ledc_timer_config(&t);
  ledc_channel_config_t ca = { .gpio_num = PWMA, .speed_mode = LEDC_LOW_SPEED_MODE, .channel = LEDC_CHANNEL_0, .timer_sel = LEDC_TIMER_0, .duty = 0 };
  ledc_channel_config(&ca);
  ledc_channel_config_t cb = { .gpio_num = PWMB, .speed_mode = LEDC_LOW_SPEED_MODE, .channel = LEDC_CHANNEL_1, .timer_sel = LEDC_TIMER_0, .duty = 0 };
  ledc_channel_config(&cb);
  gpio_set_level(STBY, 1);
  ESP_LOGI(TAG, "reference firmware ready");

  double last_err = 0;
  int64_t last_us = esp_timer_get_time();
  int turning = 0;      /* 0 follow, 1 turn left, 2 U-turn */
  int64_t turn_until = 0;
  uint32_t loops = 0;
  while (1) {
    int v[N];
    for (int i = 0; i < N; i++) {
      int raw = 0;
      adc_oneshot_read(units[unit_of[i]], chan_of[i], &raw);
      int c = (raw - WHITE) * 1000 / (BLACK - WHITE);
      v[i] = c < 0 ? 0 : (c > 1000 ? 1000 : c);
    }
    int sum = 0, wsum = 0, on = 0;
    for (int i = 0; i < N; i++) { sum += v[i]; wsum += v[i] * (i * 2 - (N - 1)); if (v[i] > 500) on++; }
    int64_t now = esp_timer_get_time();
    bool left_branch = v[N - 1] > 500 && v[N - 2] > 500;
    if (turning == 0 && left_branch && on >= 4) { turning = 1; turn_until = now + 260000; }
    if (turning == 0 && on == 0) { turning = 2; turn_until = now + 180000; }
    if (turning != 0) {
      if (turning == 1) motors(-300, 700); else motors(-650, 650);
      if (now > turn_until && v[3] + v[4] > 900) { turning = 0; last_err = 0; }
    } else {
      double err = sum > 0 ? (double)wsum / (double)sum : 0.0;
      double dt = (double)(now - last_us) / 1e6;
      double d = dt > 0 ? (err - last_err) / dt : 0.0;
      double corr = KP * err + KD * d * 0.01;
      motors(BASE + (int)corr, BASE - (int)corr);
      last_err = err;
    }
    last_us = now;
    if (++loops % 250 == 0) ESP_LOGI(TAG, "t=%lld ms on=%d turning=%d", (long long)(now / 1000), on, turning);
    vTaskDelay(pdMS_TO_TICKS(2));
  }
}
