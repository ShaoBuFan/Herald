/**
 * 合并外部 AbortSignal 与超时。调用方不需要自己管理 timer。
 */
export function createTimeoutSignal(
  timeoutSeconds: number,
  external?: AbortSignal,
): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutSeconds * 1000,
  );
  timer.unref();

  if (external) {
    if (external.aborted) {
      controller.abort();
    } else {
      external.addEventListener(
        "abort",
        () => controller.abort(),
        { once: true },
      );
    }
  }

  return controller.signal;
}
