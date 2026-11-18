#ifndef ESP_ADC_ONESHOT_H
#define ESP_ADC_ONESHOT_H
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef enum { ADC_UNIT_1 = 0, ADC_UNIT_2 = 1 } adc_unit_t;
typedef enum { ADC_CHANNEL_0 = 0, ADC_CHANNEL_1, ADC_CHANNEL_2, ADC_CHANNEL_3, ADC_CHANNEL_4, ADC_CHANNEL_5, ADC_CHANNEL_6, ADC_CHANNEL_7, ADC_CHANNEL_8, ADC_CHANNEL_9 } adc_channel_t;
typedef enum { ADC_ATTEN_DB_0 = 0, ADC_ATTEN_DB_2_5 = 1, ADC_ATTEN_DB_6 = 2, ADC_ATTEN_DB_12 = 3, ADC_ATTEN_DB_11 = 3 } adc_atten_t;
typedef enum { ADC_BITWIDTH_DEFAULT = 0, ADC_BITWIDTH_9 = 9, ADC_BITWIDTH_10 = 10, ADC_BITWIDTH_11 = 11, ADC_BITWIDTH_12 = 12, ADC_BITWIDTH_13 = 13 } adc_bitwidth_t;
typedef enum { ADC_ULP_MODE_DISABLE = 0, ADC_ULP_MODE_FSM, ADC_ULP_MODE_RISCV } adc_ulp_mode_t;
typedef enum { ADC_RTC_CLK_SRC_DEFAULT = 0, ADC_DIGI_CLK_SRC_DEFAULT = 0 } adc_oneshot_clk_src_t;
typedef struct { adc_unit_t unit_id; adc_oneshot_clk_src_t clk_src; adc_ulp_mode_t ulp_mode; } adc_oneshot_unit_init_cfg_t;
typedef struct { adc_atten_t atten; adc_bitwidth_t bitwidth; } adc_oneshot_chan_cfg_t;
typedef struct adc_oneshot_unit_ctx_t *adc_oneshot_unit_handle_t;
esp_err_t adc_oneshot_new_unit(const adc_oneshot_unit_init_cfg_t *cfg, adc_oneshot_unit_handle_t *out);
esp_err_t adc_oneshot_config_channel(adc_oneshot_unit_handle_t h, adc_channel_t ch, const adc_oneshot_chan_cfg_t *cfg);
esp_err_t adc_oneshot_read(adc_oneshot_unit_handle_t h, adc_channel_t ch, int *out_raw);
esp_err_t adc_oneshot_del_unit(adc_oneshot_unit_handle_t h);
#ifdef __cplusplus
}
#endif
#endif
