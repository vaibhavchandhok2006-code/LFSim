// LFSim JavaScript translation of main.c (reference firmware), following the lfsim-robot translation rules:
// integer maths with Math.trunc, output parameters as { value } objects, delays awaited.
const TAG = "REF";                                                              //@L16
const N = 8;                                                                    //@L17
const WHITE = 300, BLACK = 2600;                                                //@L18-19
const AIN1 = 17, AIN2 = 18, BIN1 = 13, BIN2 = 22, STBY = 23, PWMA = 16, PWMB = 19; //@L20-26
const BASE = 620, KP = 34.0, KD = 260.0;                                        //@L27-29
const unit_of = [0, 0, 0, 0, 0, 0, 1, 1];                                       //@L32
const chan_of = [ADC_CHANNEL_0, ADC_CHANNEL_3, ADC_CHANNEL_6, ADC_CHANNEL_7, ADC_CHANNEL_4, ADC_CHANNEL_5, ADC_CHANNEL_8, ADC_CHANNEL_9]; //@L33
const units = [null, null];                                                     //@L34

function motors(left, right) {                                                  //@L36
  if (left > 1023) left = 1023;                                                 //@L37
  if (left < -1023) left = -1023;                                               //@L38
  if (right > 1023) right = 1023;                                               //@L39
  if (right < -1023) right = -1023;                                             //@L40
  gpio_set_level(AIN1, left >= 0 ? 1 : 0);                                      //@L41
  gpio_set_level(AIN2, left >= 0 ? 0 : 1);                                      //@L42
  gpio_set_level(BIN1, right >= 0 ? 1 : 0);                                     //@L43
  gpio_set_level(BIN2, right >= 0 ? 0 : 1);                                     //@L44
  ledc_set_duty(LEDC_LOW_SPEED_MODE, 0, left >= 0 ? left : -left);              //@L45
  ledc_update_duty(LEDC_LOW_SPEED_MODE, 0);                                     //@L46
  ledc_set_duty(LEDC_LOW_SPEED_MODE, 1, right >= 0 ? right : -right);           //@L47
  ledc_update_duty(LEDC_LOW_SPEED_MODE, 1);                                     //@L48
}

async function app_main() {                                                     //@L51
  for (let u = 0; u < 2; u++) {                                                 //@L52
    const out = { value: null };
    adc_oneshot_new_unit({ unit_id: u === 0 ? ADC_UNIT_1 : ADC_UNIT_2 }, out);  //@L53-54
    units[u] = out.value;
  }
  const ccfg = { atten: ADC_ATTEN_DB_12, bitwidth: ADC_BITWIDTH_12 };           //@L56
  for (let i = 0; i < N; i++) adc_oneshot_config_channel(units[unit_of[i]], chan_of[i], ccfg); //@L57
  gpio_config({ pin_bit_mask: (1n << 17n) | (1n << 18n) | (1n << 13n) | (1n << 22n) | (1n << 23n), mode: 2 }); //@L58-59
  ledc_timer_config({ speed_mode: LEDC_LOW_SPEED_MODE, duty_resolution: 10, timer_num: 0, freq_hz: 5000 }); //@L60-61
  ledc_channel_config({ gpio_num: PWMA, channel: 0, duty: 0 });                 //@L62-63
  ledc_channel_config({ gpio_num: PWMB, channel: 1, duty: 0 });                 //@L64-65
  gpio_set_level(STBY, 1);                                                      //@L66
  ESP_LOGI(TAG, "reference firmware ready");                                    //@L67

  let last_err = 0;                                                             //@L69
  let last_us = esp_timer_get_time();                                           //@L70
  let turning = 0;                                                              //@L71
  let turn_until = 0;                                                           //@L72
  let loops = 0;                                                                //@L73
  while (1) {                                                                   //@L74
    const v = new Array(N);                                                     //@L75
    for (let i = 0; i < N; i++) {                                               //@L76
      const raw = { value: 0 };                                                 //@L77
      adc_oneshot_read(units[unit_of[i]], chan_of[i], raw);                     //@L78
      const c = Math.trunc((raw.value - WHITE) * 1000 / (BLACK - WHITE));       //@L79
      v[i] = c < 0 ? 0 : (c > 1000 ? 1000 : c);                                 //@L80
    }
    let sum = 0, wsum = 0, on = 0;                                              //@L82
    for (let i = 0; i < N; i++) { sum += v[i]; wsum += v[i] * (i * 2 - (N - 1)); if (v[i] > 500) on++; } //@L83
    const now = esp_timer_get_time();                                           //@L84
    const left_branch = v[N - 1] > 500 && v[N - 2] > 500;                       //@L85
    if (turning === 0 && left_branch && on >= 4) { turning = 1; turn_until = now + 260000; } //@L86
    if (turning === 0 && on === 0) { turning = 2; turn_until = now + 180000; }  //@L87
    if (turning !== 0) {                                                        //@L88
      if (turning === 1) motors(-300, 700); else motors(-650, 650);             //@L89
      if (now > turn_until && v[3] + v[4] > 900) { turning = 0; last_err = 0; } //@L90
    } else {
      const err = sum > 0 ? wsum / sum : 0.0;                                   //@L92
      const dt = (now - last_us) / 1e6;                                         //@L93
      const d = dt > 0 ? (err - last_err) / dt : 0.0;                           //@L94
      const corr = KP * err + KD * d * 0.01;                                    //@L95
      motors(BASE + Math.trunc(corr), BASE - Math.trunc(corr));                 //@L96
      last_err = err;                                                           //@L97
    }
    last_us = now;                                                              //@L99
    if (++loops % 250 === 0) ESP_LOGI(TAG, "t=%lld ms on=%d turning=%d", Math.trunc(now / 1000), on, turning); //@L100
    await vTaskDelay(pdMS_TO_TICKS(2));                                         //@L101
  }
}
