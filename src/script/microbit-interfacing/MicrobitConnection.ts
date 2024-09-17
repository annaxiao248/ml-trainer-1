/**
 * (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors
 *
 * SPDX-License-Identifier: MIT
 */

export enum DeviceRequestStates {
  NONE,
  INPUT,
  OUTPUT,
}

/**
 * A connection to a micro:bit.
 */
interface MicrobitConnection {
  connect(...states: DeviceRequestStates[]): Promise<void>;

  reconnect(finalAttempt: boolean): Promise<void>;

  disconnect(): Promise<void>;
}

export default MicrobitConnection;
