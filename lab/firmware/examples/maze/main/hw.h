/* Hardware layer of the maze firmware: sensors, motors, encoders, button and switches (RMI test rig wiring). */
#ifndef MAZE_HW_H
#define MAZE_HW_H
#include <stdbool.h>
#include <stdint.h>

#define NS 8                     /* sensors; index 0 = leftmost */

void hw_init(void);
void hw_read_raw(int raw[NS]);            /* 12-bit ADC readings */
void hw_motors(double left, double right); /* duty -1..1 per wheel; + = forward */
void hw_commanded(double *left, double *right); /* the duties last set */
void hw_encoders(int32_t *left, int32_t *right); /* running counts (wraps of the 16-bit counter handled) */
bool hw_button(void);                     /* true while pressed */
int hw_switches(void);                    /* speed level 0..3 from two switches */
int64_t hw_us(void);
void hw_wait_ms(int ms);
#endif
