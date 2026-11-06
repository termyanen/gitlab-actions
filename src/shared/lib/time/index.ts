export function sleep(ms: number) {
  return new Promise<void>(function (resolve) {
    setTimeout(resolve, ms);
  });
}
