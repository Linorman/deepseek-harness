/** Generation fence shared by independently owned Team readers. */
export class ReadRequest {
  private epoch = 0
  private controller: AbortController | undefined

  /** Publication epoch; changes before any synchronous abort callbacks. */
  get generation(): number { return this.epoch }
  /** In-flight carrier, absent after cancellation or settlement. */
  get request(): AbortController | undefined { return this.controller }

  /** Install the carrier after its owner has checked the current epoch.
   * @param controller - Newly allocated reader-local controller.
   */
  begin(controller: AbortController): void { this.controller = controller }

  /** Fence publication, release owner scheduling, then abort old transport IO.
   * @param stopScheduling - Optional owner callback retiring its polling timer.
   * @returns the cancelled epoch; abort callbacks may already have advanced it.
   */
  cancel(stopScheduling?: () => void): number {
    const epoch = ++this.epoch
    stopScheduling?.()
    const controller = this.controller
    this.controller = undefined
    controller?.abort()
    return epoch
  }

  /** Determine whether a response still owns publication.
   * @param epoch - Epoch captured before the request starts.
   * @param controller - That request's cancellation source.
   * @returns whether generation and cancellation still permit publication.
   */
  current(epoch: number, controller: AbortController): boolean {
    return epoch === this.epoch && !controller.signal.aborted
  }

  /** Retire a settled carrier without disturbing a replacement request.
   * @param controller - Carrier whose operation finished.
   * @param onFinished - Optional owner scheduling callback after carrier retirement.
   */
  finish(controller: AbortController, onFinished?: () => void): void {
    if (this.controller !== controller) return
    this.controller = undefined
    onFinished?.()
  }
}
