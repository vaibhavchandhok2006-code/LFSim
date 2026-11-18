/* LFSim hardware shim for native firmware.
 *
 * The firmware is compiled as an ordinary program for this computer. Every hardware call goes to the simulator as one
 * line on stdout; calls that return something wait for one line back on stdin:
 *   firmware → simulator   {"f":"gpio_set_level","a":[17,1],"r":0,"o":0}
 *   simulator → firmware   R <result> <out>       result of a call that waits (r = 1); out: output parameter (o = 1)
 *                          I <k>                  interrupt k fired (runs after the current call returns)
 * The simulator runs each call through the same hardware model as LFSim's Code mode, so time, sensors and motors
 * behave the same. Simulated time only advances inside calls (each costs a little, delays run the physics).
 */
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "lfsim_api.h"
#include "sdkconfig.h"
#include "esp_err.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "driver/ledc.h"
#include "esp_adc/adc_oneshot.h"
#include "rom/ets_sys.h"

#undef printf
#undef puts
#undef putchar

/* ---------------------------------------------------------------- protocol */

#define MAX_ISR 32
static struct { void (*fn)(void *); void *arg; } isr_table[MAX_ISR];
static int isr_count = 0;
static volatile int isr_pending[MAX_ISR];
static int in_isr = 0;

int lfsim_register_isr(void (*fn)(void *), void *arg) {
  if (isr_count >= MAX_ISR) lfsim_fail("too many interrupt handlers (max %d)", MAX_ISR);
  isr_table[isr_count].fn = fn;
  isr_table[isr_count].arg = arg;
  return isr_count++;
}

static void run_pending_isrs(void) {
  if (in_isr) return;
  in_isr = 1;
  for (int k = 0; k < isr_count; k += 1) {
    while (isr_pending[k] > 0) { isr_pending[k] -= 1; isr_table[k].fn(isr_table[k].arg); }
  }
  in_isr = 0;
}

static void send_line(const char *name, const char *args_json, int reply, int out) {
  fprintf(stdout, "{\"f\":\"%s\",\"a\":[%s],\"r\":%d,\"o\":%d}\n", name, args_json ? args_json : "", reply, out);
}

double lfsim_call(const char *name, const char *args_json, int reply, double *out) {
  send_line(name, args_json, reply || out != NULL, out != NULL);
  if (!reply && !out) return 0;
  fflush(stdout);
  char line[256];
  for (;;) {
    if (!fgets(line, sizeof line, stdin)) exit(0); /* the simulator ended the run */
    if (line[0] == 'I') { int k = atoi(line + 2); if (k >= 0 && k < isr_count) isr_pending[k] += 1; continue; }
    if (line[0] == 'R') {
      double r = 0, o = 0;
      sscanf(line + 2, "%lf %lf", &r, &o);
      if (out) *out = o;
      run_pending_isrs();
      return r;
    }
    if (line[0] == 'X') exit(0);
  }
}

/* JSON string body (without quotes) of text. */
static void json_escape(const char *in, char *out, size_t cap) {
  size_t j = 0;
  for (size_t i = 0; in[i] && j + 7 < cap; i += 1) {
    unsigned char c = (unsigned char)in[i];
    if (c == '"' || c == '\\') { out[j++] = '\\'; out[j++] = (char)c; }
    else if (c == '\n') { out[j++] = '\\'; out[j++] = 'n'; }
    else if (c == '\r') { out[j++] = '\\'; out[j++] = 'r'; }
    else if (c == '\t') { out[j++] = '\\'; out[j++] = 't'; }
    else if (c < 0x20) { j += (size_t)snprintf(out + j, cap - j, "\\u%04x", c); }
    else out[j++] = (char)c;
  }
  out[j] = 0;
}

static void send_text(const char *kind, const char *a, const char *b) {
  static char ea[4096], eb[256];
  json_escape(a, ea, sizeof ea);
  if (b) { json_escape(b, eb, sizeof eb); char args[4400]; snprintf(args, sizeof args, "\"%s\",\"%s\"", eb, ea); send_line(kind, args, 0, 0); }
  else { char args[4200]; snprintf(args, sizeof args, "\"%s\"", ea); send_line(kind, args, 0, 0); }
}

int lfsim_printf(const char *fmt, ...) {
  char buf[4000];
  va_list ap; va_start(ap, fmt);
  int n = vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  send_text("__print", buf, NULL);
  return n;
}
int lfsim_puts(const char *s) { char buf[4000]; snprintf(buf, sizeof buf, "%s\n", s); send_text("__print", buf, NULL); return 1; }
int lfsim_putchar(int c) { char buf[2] = { (char)c, 0 }; send_text("__print", buf, NULL); return c; }

void lfsim_log(char level, const char *tag, const char *fmt, ...) {
  char buf[4000];
  va_list ap; va_start(ap, fmt);
  vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  char lv[2] = { level, 0 };
  char args[4400], et[256], eb[4100];
  json_escape(tag, et, sizeof et); json_escape(buf, eb, sizeof eb);
  snprintf(args, sizeof args, "\"%s\",\"%s\",\"%s\"", lv, et, eb);
  send_line("__log", args, 0, 0);
}

void lfsim_fail(const char *fmt, ...) {
  char buf[1000];
  va_list ap; va_start(ap, fmt);
  vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  send_text("__fail", buf, NULL);
  fflush(stdout);
  exit(3);
}

#define A(...) (snprintf(args_, sizeof args_, __VA_ARGS__), args_)
static char args_[512];

/* ---------------------------------------------------------------- time and tasks */

int64_t esp_timer_get_time(void) { return (int64_t)lfsim_call("esp_timer_get_time", "", 1, NULL); }
void vTaskDelay(TickType_t ticks) { lfsim_call("vTaskDelay", A("%.6f", (double)ticks * 1000.0 / configTICK_RATE_HZ), 1, NULL); }
TickType_t xTaskGetTickCount(void) { return (TickType_t)(((uint64_t)lfsim_call("millis", "", 1, NULL) * configTICK_RATE_HZ) / 1000); }
void taskYIELD(void) { lfsim_call("taskYIELD", "", 1, NULL); }
void ets_delay_us(uint32_t us) { lfsim_call("ets_delay_us", A("%u", us), 1, NULL); }
void vTaskDelete(TaskHandle_t t) {
  if (t != NULL) lfsim_fail("vTaskDelete: only the calling task (NULL) can be deleted in the simulator");
  for (;;) vTaskDelay(pdMS_TO_TICKS(10) ? pdMS_TO_TICKS(10) : 1);
}
BaseType_t xTaskCreate(void (*fn)(void *), const char *name, uint32_t stack, void *arg, UBaseType_t prio, TaskHandle_t *out) {
  (void)fn; (void)stack; (void)arg; (void)prio; (void)out;
  lfsim_fail("xTaskCreate(\"%s\"): extra FreeRTOS tasks are not simulated yet (run the work from app_main)", name ? name : "");
}
BaseType_t xTaskCreatePinnedToCore(void (*fn)(void *), const char *name, uint32_t stack, void *arg, UBaseType_t prio, TaskHandle_t *out, BaseType_t core) {
  (void)core; return xTaskCreate(fn, name, stack, arg, prio, out);
}

/* ---------------------------------------------------------------- GPIO */

esp_err_t gpio_config(const gpio_config_t *c) {
  lfsim_call("gpio_config", A("{\"pin_bit_mask\":\"%llu\",\"mode\":%d,\"intr_type\":%d}", (unsigned long long)c->pin_bit_mask, (int)c->mode, (int)c->intr_type), 0, NULL);
  return ESP_OK;
}
esp_err_t gpio_reset_pin(gpio_num_t pin) { lfsim_call("gpio_reset_pin", A("%d", pin), 0, NULL); return ESP_OK; }
esp_err_t gpio_set_direction(gpio_num_t pin, gpio_mode_t mode) { lfsim_call("gpio_set_direction", A("%d,%d", pin, mode), 0, NULL); return ESP_OK; }
esp_err_t gpio_set_level(gpio_num_t pin, uint32_t level) { lfsim_call("gpio_set_level", A("%d,%u", pin, level ? 1u : 0u), 0, NULL); return ESP_OK; }
int gpio_get_level(gpio_num_t pin) { return (int)lfsim_call("gpio_get_level", A("%d", pin), 1, NULL); }
esp_err_t gpio_set_pull_mode(gpio_num_t pin, gpio_pull_mode_t p) { (void)pin; (void)p; return ESP_OK; }
esp_err_t gpio_pullup_en(gpio_num_t pin) { (void)pin; return ESP_OK; }
esp_err_t gpio_pullup_dis(gpio_num_t pin) { (void)pin; return ESP_OK; }
esp_err_t gpio_pulldown_en(gpio_num_t pin) { (void)pin; return ESP_OK; }
esp_err_t gpio_pulldown_dis(gpio_num_t pin) { (void)pin; return ESP_OK; }
esp_err_t gpio_set_intr_type(gpio_num_t pin, gpio_int_type_t t) { lfsim_call("gpio_set_intr_type", A("%d,%d", pin, t), 0, NULL); return ESP_OK; }
esp_err_t gpio_intr_enable(gpio_num_t pin) { (void)pin; return ESP_OK; }
esp_err_t gpio_intr_disable(gpio_num_t pin) { (void)pin; return ESP_OK; }
esp_err_t gpio_install_isr_service(int flags) { (void)flags; return ESP_OK; }
void gpio_uninstall_isr_service(void) {}
esp_err_t gpio_isr_handler_add(gpio_num_t pin, gpio_isr_t fn, void *arg) {
  int k = lfsim_register_isr(fn, arg);
  lfsim_call("gpio_isr_handler_add", A("%d,{\"cb\":%d}", pin, k), 0, NULL);
  return ESP_OK;
}
esp_err_t gpio_isr_handler_remove(gpio_num_t pin) { lfsim_call("gpio_isr_handler_remove", A("%d", pin), 0, NULL); return ESP_OK; }

/* ---------------------------------------------------------------- LEDC PWM */

esp_err_t ledc_timer_config(const ledc_timer_config_t *c) {
  lfsim_call("ledc_timer_config", A("{\"duty_resolution\":%d,\"timer_num\":%d,\"freq_hz\":%u}", (int)c->duty_resolution, (int)c->timer_num, c->freq_hz), 0, NULL);
  return ESP_OK;
}
esp_err_t ledc_channel_config(const ledc_channel_config_t *c) {
  lfsim_call("ledc_channel_config", A("{\"gpio_num\":%d,\"channel\":%d,\"duty\":%u}", c->gpio_num, (int)c->channel, c->duty), 0, NULL);
  return ESP_OK;
}
static uint32_t ledc_duty_cache[LEDC_SPEED_MODE_MAX][LEDC_CHANNEL_MAX];
esp_err_t ledc_set_duty(ledc_mode_t mode, ledc_channel_t ch, uint32_t duty) {
  if ((int)ch >= 0 && ch < LEDC_CHANNEL_MAX && (int)mode >= 0 && mode < LEDC_SPEED_MODE_MAX) ledc_duty_cache[mode][ch] = duty;
  lfsim_call("ledc_set_duty", A("%d,%d,%u", (int)mode, (int)ch, duty), 0, NULL);
  return ESP_OK;
}
esp_err_t ledc_update_duty(ledc_mode_t mode, ledc_channel_t ch) { lfsim_call("ledc_update_duty", A("%d,%d", (int)mode, (int)ch), 0, NULL); return ESP_OK; }
uint32_t ledc_get_duty(ledc_mode_t mode, ledc_channel_t ch) { return ((int)ch >= 0 && ch < LEDC_CHANNEL_MAX && (int)mode >= 0 && mode < LEDC_SPEED_MODE_MAX) ? ledc_duty_cache[mode][ch] : 0; }
esp_err_t ledc_set_freq(ledc_mode_t mode, ledc_timer_t timer, uint32_t freq) { (void)mode; (void)timer; (void)freq; return ESP_OK; }
esp_err_t ledc_stop(ledc_mode_t mode, ledc_channel_t ch, uint32_t idle) {
  ledc_set_duty(mode, ch, 0); ledc_update_duty(mode, ch); (void)idle; return ESP_OK;
}

/* ---------------------------------------------------------------- ADC one-shot (handles are small numbers) */

esp_err_t adc_oneshot_new_unit(const adc_oneshot_unit_init_cfg_t *c, adc_oneshot_unit_handle_t *out) {
  double h = 0;
  esp_err_t r = (esp_err_t)lfsim_call("adc_oneshot_new_unit", A("{\"unit_id\":%d}", (int)c->unit_id), 1, &h);
  *out = (adc_oneshot_unit_handle_t)(intptr_t)h;
  return r;
}
esp_err_t adc_oneshot_config_channel(adc_oneshot_unit_handle_t h, adc_channel_t ch, const adc_oneshot_chan_cfg_t *c) {
  return (esp_err_t)lfsim_call("adc_oneshot_config_channel", A("{\"h\":%d},%d,{\"atten\":%d,\"bitwidth\":%d}", (int)(intptr_t)h, (int)ch, (int)c->atten, (int)c->bitwidth), 1, NULL);
}
esp_err_t adc_oneshot_read(adc_oneshot_unit_handle_t h, adc_channel_t ch, int *out_raw) {
  double v = 0;
  esp_err_t r = (esp_err_t)lfsim_call("adc_oneshot_read", A("{\"h\":%d},%d", (int)(intptr_t)h, (int)ch), 1, &v);
  *out_raw = (int)v;
  return r;
}
esp_err_t adc_oneshot_del_unit(adc_oneshot_unit_handle_t h) { (void)h; return ESP_OK; }

/* ---------------------------------------------------------------- start */

void app_main(void);

int main(void) {
  setvbuf(stdout, NULL, _IOFBF, 1 << 16);
  app_main();
  for (;;) vTaskDelay(pdMS_TO_TICKS(10) ? pdMS_TO_TICKS(10) : 1); /* app_main returned: the chip idles */
}
