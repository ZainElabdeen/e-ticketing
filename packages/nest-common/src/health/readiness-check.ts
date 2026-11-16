/** One hard dependency of the service. `check()` resolves when it is up and rejects when it is down. */
export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<void>;
}
