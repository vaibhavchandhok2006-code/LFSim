/* Hardware layer: ADC one-shot reads, LEDC PWM + TB6612FNG direction pins, PCNT quadrature encoders, GPIO inputs. */
#include "hw.h"
#include "config.h"
#include "driver/gpio.h"
#include "driver/ledc.h"
#include "driver/pulse_cnt.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define AIN1 GPIO_NUM_17
#define AIN2 GPIO_NUM_18
#define BIN1 GPIO_NUM_13
#define BIN2 GPIO_NUM_22
#define STBY GPIO_NUM_23
#define PWMA GPIO_NUM_16
#define PWMB GPIO_NUM_19
#define ENC_LA 27
#define ENC_LB 14
#define ENC_RA 5
#define ENC_RB 15
#define DUTY_MAX 1023            /* 10-bit PWM */

/* leftmost first: GPIO 26, 25 (ADC2), 33, 32, 35, 34, 39, 36 (ADC1) */
static const int unit_of[NS] = { 1, 1, 0, 0, 0, 0, 0, 0 };
static const adc_channel_t chan_of[NS] = { ADC_CHANNEL_9, ADC_CHANNEL_8, ADC_CHANNEL_5, ADC_CHANNEL_4, ADC_CHANNEL_7, ADC_CHANNEL_6, ADC_CHANNEL_3, ADC_CHANNEL_0 };
static adc_oneshot_unit_handle_t units[2];
static pcnt_unit_handle_t enc_unit[2];
static int16_t enc_last[2];
static int32_t enc_total[2];

static pcnt_unit_handle_t encoder(int a, int b) {
  pcnt_unit_config_t uc = { .low_limit = -32768, .high_limit = 32767 };
  pcnt_unit_handle_t u;
  pcnt_new_unit(&uc, &u);
  pcnt_glitch_filter_config_t gf = { .max_glitch_ns = 1000 };
  pcnt_unit_set_glitch_filter(u, &gf);
  pcnt_chan_config_t ca = { .edge_gpio_num = a, .level_gpio_num = b }, cb = { .edge_gpio_num = b, .level_gpio_num = a };
  pcnt_channel_handle_t cha, chb;
  pcnt_new_channel(u, &ca, &cha);
  pcnt_new_channel(u, &cb, &chb);
  pcnt_channel_set_edge_action(cha, PCNT_CHANNEL_EDGE_ACTION_DECREASE, PCNT_CHANNEL_EDGE_ACTION_INCREASE);
  pcnt_channel_set_level_action(cha, PCNT_CHANNEL_LEVEL_ACTION_KEEP, PCNT_CHANNEL_LEVEL_ACTION_INVERSE);
  pcnt_channel_set_edge_action(chb, PCNT_CHANNEL_EDGE_ACTION_INCREASE, PCNT_CHANNEL_EDGE_ACTION_DECREASE);
  pcnt_channel_set_level_action(chb, PCNT_CHANNEL_LEVEL_ACTION_KEEP, PCNT_CHANNEL_LEVEL_ACTION_INVERSE);
  pcnt_unit_enable(u);
  pcnt_unit_clear_count(u);
  pcnt_unit_start(u);
  return u;
}

void hw_init(void) {
  for (int u = 0; u < 2; u++) {
    adc_oneshot_unit_init_cfg_t ucfg = { .unit_id = u == 0 ? ADC_UNIT_1 : ADC_UNIT_2 };
    adc_oneshot_new_unit(&ucfg, &units[u]);
  }
  adc_oneshot_chan_cfg_t ccfg = { .atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_12 };
  for (int i = 0; i < NS; i++) adc_oneshot_config_channel(units[unit_of[i]], chan_of[i], &ccfg);
  gpio_config_t out = { .pin_bit_mask = (1ULL << AIN1) | (1ULL << AIN2) | (1ULL << BIN1) | (1ULL << BIN2) | (1ULL << STBY), .mode = GPIO_MODE_OUTPUT };
  gpio_config(&out);
  gpio_config_t in = { .pin_bit_mask = (1ULL << PIN_BUTTON) | (1ULL << PIN_SW0) | (1ULL << PIN_SW1), .mode = GPIO_MODE_INPUT, .pull_up_en = GPIO_PULLUP_ENABLE };
  gpio_config(&in);
  ledc_timer_config_t t = { .speed_mode = LEDC_LOW_SPEED_MODE, .duty_resolution = LEDC_TIMER_10_BIT, .timer_num = LEDC_TIMER_0, .freq_hz = 5000, .clk_cfg = LEDC_AUTO_CLK };
  ledc_timer_config(&t);
  ledc_channel_config_t ca = { .gpio_num = PWMA, .speed_mode = LEDC_LOW_SPEED_MODE, .channel = LEDC_CHANNEL_0, .timer_sel = LEDC_TIMER_0, .duty = 0 };
  ledc_channel_config(&ca);
  ledc_channel_config_t cb = { .gpio_num = PWMB, .speed_mode = LEDC_LOW_SPEED_MODE, .channel = LEDC_CHANNEL_1, .timer_sel = LEDC_TIMER_0, .duty = 0 };
  ledc_channel_config(&cb);
  enc_unit[0] = encoder(ENC_LA, ENC_LB);
  enc_unit[1] = encoder(ENC_RA, ENC_RB);
  gpio_set_level(STBY, 1);
}

void hw_read_raw(int raw[NS]) {
  for (int i = 0; i < NS; i++) adc_oneshot_read(units[unit_of[i]], chan_of[i], &raw[i]);
}

/* Only write what changed: fewer bus writes on the chip, fewer messages in the simulator. */
static int last_duty[2] = { -1, -1 }, last_dir[2] = { -1, -1 };
static void wheel(int side, double d) {
  int dir = d >= 0 ? 1 : 0;
  int duty = (int)((d >= 0 ? d : -d) * DUTY_MAX + 0.5);
  if (duty > DUTY_MAX) duty = DUTY_MAX;
  if (dir != last_dir[side]) {
    if (side == 0) { gpio_set_level(AIN1, dir); gpio_set_level(AIN2, !dir); }
    else { gpio_set_level(BIN1, dir); gpio_set_level(BIN2, !dir); }
    last_dir[side] = dir;
  }
  if (duty != last_duty[side]) {
    ledc_channel_t ch = side == 0 ? LEDC_CHANNEL_0 : LEDC_CHANNEL_1;
    ledc_set_duty(LEDC_LOW_SPEED_MODE, ch, (uint32_t)duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, ch);
    last_duty[side] = duty;
  }
}
static double cmd[2];
void hw_motors(double left, double right) { cmd[0] = left; cmd[1] = right; wheel(0, left); wheel(1, right); }
void hw_commanded(double *left, double *right) { *left = cmd[0]; *right = cmd[1]; }

void hw_encoders(int32_t *left, int32_t *right) {
  for (int k = 0; k < 2; k++) {
    int v = 0;
    pcnt_unit_get_count(enc_unit[k], &v);
    int16_t now = (int16_t)v;
    enc_total[k] += (int16_t)(now - enc_last[k]); /* difference in 16 bits survives the counter wrapping */
    enc_last[k] = now;
  }
  *left = enc_total[0];
  *right = enc_total[1];
}

bool hw_button(void) { return gpio_get_level(PIN_BUTTON) == 0; }
int hw_switches(void) { return (gpio_get_level(PIN_SW0) ? 1 : 0) | (gpio_get_level(PIN_SW1) ? 2 : 0); }
int64_t hw_us(void) { return esp_timer_get_time(); }
void hw_wait_ms(int ms) { vTaskDelay(pdMS_TO_TICKS(ms)); }
