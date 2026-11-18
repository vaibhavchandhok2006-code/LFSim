/* LFSim hardware shim: forced into every firmware file when it is compiled for the simulator (gcc -include).
 * Your code is unchanged; this only routes printf / puts to the simulator's serial console. */
#ifndef LFSIM_SHIM_H
#define LFSIM_SHIM_H
#include <stdio.h>
#include <stdint.h>
#include <stdarg.h>
#ifdef __cplusplus
extern "C" {
#endif
int lfsim_printf(const char *fmt, ...) __attribute__((format(__printf__, 1, 2)));
int lfsim_puts(const char *s);
int lfsim_putchar(int c);
#ifdef __cplusplus
}
#endif
#define printf lfsim_printf
#define puts lfsim_puts
#define putchar lfsim_putchar
#define LFSIM 1
#endif
