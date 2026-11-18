/* Internal: the call interface between the shim and the simulator (one line per call over a pipe). */
#ifndef LFSIM_API_H
#define LFSIM_API_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Send a call. args_json: a JSON array body without brackets (e.g. "4,1"). reply: wait for the result.
 * out: the simulator also returns an output value (written to *out). Returns the call's result. */
double lfsim_call(const char *name, const char *args_json, int reply, double *out);
void lfsim_log(char level, const char *tag, const char *fmt, ...) __attribute__((format(__printf__, 3, 4)));
void lfsim_fail(const char *fmt, ...) __attribute__((format(__printf__, 1, 2), noreturn));
int lfsim_register_isr(void (*fn)(void *), void *arg);
#ifdef __cplusplus
}
#endif
#endif
