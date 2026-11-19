/* LFSim hardware shim for native firmware.
 *
 * The firmware is compiled as an ordinary program for this computer. Every hardware call goes to the simulator as one
 * line on stdout; calls that return something wait for one line back on stdin:
 *   firmware → simulator   {"f":"gpio_set_level","a":[17,1],"r":0,"o":0}
 *   simulator → firmware   R <result> <out>       result of a call that waits (r = 1); out: output parameter (o = 1)
 *   simulator → firmware   T <length> <hex>       bytes read from simulated flash (length -1: not found)
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
#include "nvs.h"
#include "nvs_flash.h"

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

/* ---------------------------------------------------------------- NVS (flash; kept between the runs of a session) */
#define NVS_MAX_VALUE 4000
#define NVS_MAX_OPEN 16
static struct { char ns[16]; int write; int used; } nvs_open_tab[NVS_MAX_OPEN];
static char text_line[2 * NVS_MAX_VALUE + 64];

/* A call whose reply is a run of bytes ("T <len> <hex>"). Returns the length, or -1 if the key does not exist. */
static long lfsim_call_bytes(const char *name, const char *args_json, unsigned char *buf, size_t cap) {
  send_line(name, args_json, 1, 0);
  fflush(stdout);
  for (;;) {
    if (!fgets(text_line, sizeof text_line, stdin)) exit(0);
    if (text_line[0] == 'I') { int k = atoi(text_line + 2); if (k >= 0 && k < isr_count) isr_pending[k] += 1; continue; }
    if (text_line[0] == 'X') exit(0);
    if (text_line[0] == 'T') {
      char *p = text_line + 2;
      long n = strtol(p, &p, 10);
      if (n > 0) {
        while (*p == ' ') p++;
        for (long i = 0; i < n && (size_t)i < cap; i++) { unsigned v = 0; sscanf(p + 2 * i, "%2x", &v); buf[i] = (unsigned char)v; }
      }
      run_pending_isrs();
      return n;
    }
  }
}
static int nvs_name_ok(const char *s) { return s && s[0] && strlen(s) < NVS_KEY_NAME_MAX_SIZE; }
static esp_err_t nvs_check(nvs_handle_t h, const char *key, int write) {
  if (h == 0 || h > NVS_MAX_OPEN || !nvs_open_tab[h - 1].used) return ESP_ERR_NVS_INVALID_HANDLE;
  if (key && !nvs_name_ok(key)) return key[0] ? ESP_ERR_NVS_KEY_TOO_LONG : ESP_ERR_NVS_INVALID_NAME;
  if (write && !nvs_open_tab[h - 1].write) return ESP_ERR_NVS_READ_ONLY;
  return ESP_OK;
}
static esp_err_t nvs_put(nvs_handle_t h, const char *key, const char *type, const void *data, size_t n) {
  esp_err_t e = nvs_check(h, key, 1);
  if (e != ESP_OK) return e;
  if (n > NVS_MAX_VALUE) return ESP_ERR_NVS_VALUE_TOO_LONG;
  static char hex[2 * NVS_MAX_VALUE + 1], args[2 * NVS_MAX_VALUE + 160], k[64];
  for (size_t i = 0; i < n; i++) sprintf(hex + 2 * i, "%02x", ((const unsigned char *)data)[i]);
  hex[2 * n] = 0;
  json_escape(key, k, sizeof k);
  snprintf(args, sizeof args, "\"%s\",\"%s\",\"%s\",\"%s\"", nvs_open_tab[h - 1].ns, k, type, hex);
  lfsim_call("__nvs_set", args, 0, NULL);
  return ESP_OK;
}
static long nvs_fetch(nvs_handle_t h, const char *key, const char *type, unsigned char *buf, size_t cap, esp_err_t *err) {
  *err = nvs_check(h, key, 0);
  if (*err != ESP_OK) return -1;
  char args[160], k[64];
  json_escape(key, k, sizeof k);
  snprintf(args, sizeof args, "\"%s\",\"%s\",\"%s\"", nvs_open_tab[h - 1].ns, k, type);
  long n = lfsim_call_bytes("__nvs_get", args, buf, cap);
  if (n < 0) *err = ESP_ERR_NVS_NOT_FOUND;
  return n;
}
esp_err_t nvs_flash_init(void) { return ESP_OK; }
esp_err_t nvs_flash_deinit(void) { return ESP_OK; }
esp_err_t nvs_flash_erase(void) { lfsim_call("__nvs_erase", "\"*\",null", 0, NULL); return ESP_OK; }
esp_err_t nvs_open(const char *name, nvs_open_mode_t mode, nvs_handle_t *out) {
  if (!nvs_name_ok(name)) return ESP_ERR_NVS_INVALID_NAME;
  for (int i = 0; i < NVS_MAX_OPEN; i++) if (!nvs_open_tab[i].used) {
    char esc[40]; json_escape(name, esc, sizeof esc);
    snprintf(nvs_open_tab[i].ns, sizeof nvs_open_tab[i].ns, "%s", esc);
    nvs_open_tab[i].write = mode == NVS_READWRITE; nvs_open_tab[i].used = 1;
    *out = (nvs_handle_t)(i + 1);
    return ESP_OK;
  }
  return ESP_ERR_NVS_NOT_ENOUGH_SPACE;
}
void nvs_close(nvs_handle_t h) { if (h >= 1 && h <= NVS_MAX_OPEN) nvs_open_tab[h - 1].used = 0; }
esp_err_t nvs_commit(nvs_handle_t h) { return nvs_check(h, NULL, 0); }
esp_err_t nvs_erase_key(nvs_handle_t h, const char *key) {
  esp_err_t e = nvs_check(h, key, 1);
  if (e != ESP_OK) return e;
  unsigned char b[1]; esp_err_t fe;
  if (nvs_fetch(h, key, "*", b, 0, &fe) < 0) return ESP_ERR_NVS_NOT_FOUND;
  char args[160], k[64]; json_escape(key, k, sizeof k);
  snprintf(args, sizeof args, "\"%s\",\"%s\"", nvs_open_tab[h - 1].ns, k);
  lfsim_call("__nvs_erase", args, 0, NULL);
  return ESP_OK;
}
esp_err_t nvs_erase_all(nvs_handle_t h) {
  esp_err_t e = nvs_check(h, NULL, 1);
  if (e != ESP_OK) return e;
  char args[64]; snprintf(args, sizeof args, "\"%s\",null", nvs_open_tab[h - 1].ns);
  lfsim_call("__nvs_erase", args, 0, NULL);
  return ESP_OK;
}
#define NVS_INT(T, name) \
  esp_err_t nvs_set_##name(nvs_handle_t h, const char *key, T v) { return nvs_put(h, key, #name, &v, sizeof v); } \
  esp_err_t nvs_get_##name(nvs_handle_t h, const char *key, T *v) { \
    T t; esp_err_t e; long n = nvs_fetch(h, key, #name, (unsigned char *)&t, sizeof t, &e); \
    if (n < 0) return e; if (n != (long)sizeof t) return ESP_ERR_NVS_NOT_FOUND; *v = t; return ESP_OK; }
NVS_INT(int8_t, i8) NVS_INT(uint8_t, u8) NVS_INT(int16_t, i16) NVS_INT(uint16_t, u16)
NVS_INT(int32_t, i32) NVS_INT(uint32_t, u32) NVS_INT(int64_t, i64) NVS_INT(uint64_t, u64)
esp_err_t nvs_set_str(nvs_handle_t h, const char *key, const char *value) { return nvs_put(h, key, "str", value, strlen(value) + 1); }
esp_err_t nvs_set_blob(nvs_handle_t h, const char *key, const void *value, size_t length) { return nvs_put(h, key, "blob", value, length); }
/* As ESP-IDF: out == NULL asks for the length; a too-small buffer gives ESP_ERR_NVS_INVALID_LENGTH. */
static esp_err_t nvs_get_var(nvs_handle_t h, const char *key, const char *type, void *out, size_t *length) {
  static unsigned char buf[NVS_MAX_VALUE];
  esp_err_t e; long n = nvs_fetch(h, key, type, buf, sizeof buf, &e);
  if (n < 0) return e;
  if (!length) return ESP_ERR_INVALID_ARG;
  if (!out) { *length = (size_t)n; return ESP_OK; }
  if (*length < (size_t)n) { *length = (size_t)n; return ESP_ERR_NVS_INVALID_LENGTH; }
  memcpy(out, buf, (size_t)n); *length = (size_t)n;
  return ESP_OK;
}
esp_err_t nvs_get_str(nvs_handle_t h, const char *key, char *out, size_t *length) { return nvs_get_var(h, key, "str", out, length); }
esp_err_t nvs_get_blob(nvs_handle_t h, const char *key, void *out, size_t *length) { return nvs_get_var(h, key, "blob", out, length); }

/* ---------------------------------------------------------------- start */

void app_main(void);

int main(void) {
  setvbuf(stdout, NULL, _IOFBF, 1 << 16);
  app_main();
  for (;;) vTaskDelay(pdMS_TO_TICKS(10) ? pdMS_TO_TICKS(10) : 1); /* app_main returned: the chip idles */
}
