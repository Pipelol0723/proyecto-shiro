export interface DeviceStatus {
  /** ¿El dispositivo está accesible y respondiendo? */
  online: boolean;
  /**
   * Estado dependiente del tipo de dispositivo. Ejemplos:
   * - Luz: `{ on: true, brightness: 0.8, color: '#FFAA00' }`
   * - Sensor: `{ temperature: 22.5, humidity: 45 }`
   * - Motor: `{ position: 1024, moving: false }`
   */
  state?: Record<string, unknown>;
  /** ISO timestamp del último contacto con el dispositivo. */
  lastSeen?: string;
}

export interface DeviceCommand {
  /**
   * Nombre del comando. Convención: kebab-case minúscula.
   * Ejemplos: `on`, `off`, `set-brightness`, `move-to`, `play-sound`.
   */
  name: string;
  /** Argumentos del comando, libres según el tipo de dispositivo. */
  args?: Record<string, unknown>;
}

/**
 * Contrato genérico para un dispositivo controlable por el companion.
 *
 * Implementaciones futuras (Fase 11 o antes según prioridades):
 * - `MQTTLight`: luz conectada vía broker MQTT.
 * - `HomeAssistantSensor`: sensor a través de la API de Home Assistant.
 * - `ArduinoMotor`: motor controlado por un Arduino por Serial USB.
 *
 * En Fase 1 solo existe el contrato — ninguna implementación.
 *
 * Ver ADR 0003.
 */
export interface IDeviceModule {
  /** Identificador único en el `DeviceRegistry`. kebab-case. */
  readonly id: string;

  /**
   * Tipo del dispositivo. Convención: nombre genérico minúscula.
   * Ejemplos: `light`, `sensor`, `motor`, `display`, `speaker`.
   */
  readonly type: string;

  /**
   * Estado actual. La impl decide si cachea o consulta cada vez.
   * Si el dispositivo está offline, devuelve `{ online: false }`.
   */
  getStatus(): Promise<DeviceStatus>;

  /**
   * Envía un comando al dispositivo. Lanza error si el comando no
   * es soportado por este tipo de dispositivo (validación responsabilidad
   * de la impl).
   */
  sendCommand(command: DeviceCommand): Promise<void>;
}
