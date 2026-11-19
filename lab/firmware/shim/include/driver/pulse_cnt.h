/* LFSim shim: ESP-IDF v5 pulse counter (PCNT), used to count wheel encoder pulses. In the simulator the first unit
 * created counts the left wheel and the second the right wheel, in quadrature counts per wheel revolution (cpr in the
 * robot profile); the GPIOs in the channel configs are recorded but not simulated. Counts wrap like int16 unless the
 * firmware handles watch points (not simulated: keep high/low limits at ±32767 and read often). */
#ifndef DRIVER_PULSE_CNT_H
#define DRIVER_PULSE_CNT_H
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct pcnt_unit_t *pcnt_unit_handle_t;
typedef struct pcnt_chan_t *pcnt_channel_handle_t;
typedef struct { int low_limit; int high_limit; int intr_priority; struct { uint32_t accum_count : 1; } flags; } pcnt_unit_config_t;
typedef struct { int edge_gpio_num; int level_gpio_num; struct { uint32_t invert_edge_input : 1; uint32_t invert_level_input : 1; uint32_t virt_edge_io_level : 1; uint32_t virt_level_io_level : 1; uint32_t io_loop_back : 1; } flags; } pcnt_chan_config_t;
typedef struct { uint32_t max_glitch_ns; } pcnt_glitch_filter_config_t;
typedef enum { PCNT_CHANNEL_EDGE_ACTION_HOLD, PCNT_CHANNEL_EDGE_ACTION_INCREASE, PCNT_CHANNEL_EDGE_ACTION_DECREASE } pcnt_channel_edge_action_t;
typedef enum { PCNT_CHANNEL_LEVEL_ACTION_KEEP, PCNT_CHANNEL_LEVEL_ACTION_INVERSE, PCNT_CHANNEL_LEVEL_ACTION_HOLD } pcnt_channel_level_action_t;
esp_err_t pcnt_new_unit(const pcnt_unit_config_t *config, pcnt_unit_handle_t *ret_unit);
esp_err_t pcnt_del_unit(pcnt_unit_handle_t unit);
esp_err_t pcnt_unit_set_glitch_filter(pcnt_unit_handle_t unit, const pcnt_glitch_filter_config_t *config);
esp_err_t pcnt_new_channel(pcnt_unit_handle_t unit, const pcnt_chan_config_t *config, pcnt_channel_handle_t *ret_chan);
esp_err_t pcnt_channel_set_edge_action(pcnt_channel_handle_t chan, pcnt_channel_edge_action_t pos_act, pcnt_channel_edge_action_t neg_act);
esp_err_t pcnt_channel_set_level_action(pcnt_channel_handle_t chan, pcnt_channel_level_action_t high_act, pcnt_channel_level_action_t low_act);
esp_err_t pcnt_unit_enable(pcnt_unit_handle_t unit);
esp_err_t pcnt_unit_disable(pcnt_unit_handle_t unit);
esp_err_t pcnt_unit_start(pcnt_unit_handle_t unit);
esp_err_t pcnt_unit_stop(pcnt_unit_handle_t unit);
esp_err_t pcnt_unit_clear_count(pcnt_unit_handle_t unit);
esp_err_t pcnt_unit_get_count(pcnt_unit_handle_t unit, int *value);
#ifdef __cplusplus
}
#endif
#endif
