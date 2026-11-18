#ifndef DRIVER_LEDC_H
#define DRIVER_LEDC_H
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef enum { LEDC_HIGH_SPEED_MODE = 0, LEDC_LOW_SPEED_MODE = 1, LEDC_SPEED_MODE_MAX } ledc_mode_t;
typedef enum { LEDC_TIMER_0 = 0, LEDC_TIMER_1, LEDC_TIMER_2, LEDC_TIMER_3, LEDC_TIMER_MAX } ledc_timer_t;
typedef enum { LEDC_CHANNEL_0 = 0, LEDC_CHANNEL_1, LEDC_CHANNEL_2, LEDC_CHANNEL_3, LEDC_CHANNEL_4, LEDC_CHANNEL_5, LEDC_CHANNEL_6, LEDC_CHANNEL_7, LEDC_CHANNEL_MAX } ledc_channel_t;
typedef enum {
  LEDC_TIMER_1_BIT = 1, LEDC_TIMER_2_BIT, LEDC_TIMER_3_BIT, LEDC_TIMER_4_BIT, LEDC_TIMER_5_BIT, LEDC_TIMER_6_BIT, LEDC_TIMER_7_BIT,
  LEDC_TIMER_8_BIT, LEDC_TIMER_9_BIT, LEDC_TIMER_10_BIT, LEDC_TIMER_11_BIT, LEDC_TIMER_12_BIT, LEDC_TIMER_13_BIT, LEDC_TIMER_14_BIT,
  LEDC_TIMER_15_BIT, LEDC_TIMER_16_BIT, LEDC_TIMER_17_BIT, LEDC_TIMER_18_BIT, LEDC_TIMER_19_BIT, LEDC_TIMER_20_BIT, LEDC_TIMER_BIT_MAX
} ledc_timer_bit_t;
typedef enum { LEDC_AUTO_CLK = 0, LEDC_USE_APB_CLK, LEDC_USE_RTC8M_CLK, LEDC_USE_REF_TICK } ledc_clk_cfg_t;
typedef enum { LEDC_INTR_DISABLE = 0, LEDC_INTR_FADE_END } ledc_intr_type_t;
typedef struct { ledc_mode_t speed_mode; ledc_timer_bit_t duty_resolution; ledc_timer_t timer_num; uint32_t freq_hz; ledc_clk_cfg_t clk_cfg; int deconfigure; } ledc_timer_config_t;
typedef struct { int gpio_num; ledc_mode_t speed_mode; ledc_channel_t channel; ledc_intr_type_t intr_type; ledc_timer_t timer_sel; uint32_t duty; int hpoint; struct { unsigned int output_invert: 1; } flags; } ledc_channel_config_t;
esp_err_t ledc_timer_config(const ledc_timer_config_t *cfg);
esp_err_t ledc_channel_config(const ledc_channel_config_t *cfg);
esp_err_t ledc_set_duty(ledc_mode_t mode, ledc_channel_t ch, uint32_t duty);
esp_err_t ledc_update_duty(ledc_mode_t mode, ledc_channel_t ch);
esp_err_t ledc_set_freq(ledc_mode_t mode, ledc_timer_t timer, uint32_t freq);
esp_err_t ledc_stop(ledc_mode_t mode, ledc_channel_t ch, uint32_t idle_level);
uint32_t ledc_get_duty(ledc_mode_t mode, ledc_channel_t ch);
#ifdef __cplusplus
}
#endif
#endif
