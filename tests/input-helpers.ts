export function keyEvent(
  target: EventTarget,
  type: 'keydown' | 'keyup',
  code: string,
  options: {
    repeat?: boolean;
    timeStamp?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    isComposing?: boolean;
  } = {},
): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    code: { value: code },
    repeat: { value: options.repeat ?? false },
    timeStamp: { value: options.timeStamp ?? 10 },
    ctrlKey: { value: options.ctrlKey ?? false },
    metaKey: { value: options.metaKey ?? false },
    altKey: { value: options.altKey ?? false },
    isComposing: { value: options.isComposing ?? false },
  });
  target.dispatchEvent(event);
  return event;
}

export function makePad(
  options: {
    axis?: number;
    verticalAxis?: number;
    throttle?: number;
    brake?: number;
    buttons?: number[];
    index?: number;
    connected?: boolean;
    mapping?: GamepadMappingType;
  } = {},
): Gamepad {
  const buttons = Array.from({ length: 17 }, (_, index) => ({
    pressed: options.buttons?.includes(index) ?? false,
    touched: false,
    value:
      index === 7
        ? (options.throttle ?? 0)
        : index === 6
          ? (options.brake ?? 0)
          : 0,
  }));
  return {
    id: 'Test standard controller',
    index: options.index ?? 0,
    connected: options.connected ?? true,
    mapping: options.mapping ?? 'standard',
    timestamp: 0,
    axes: [options.axis ?? 0, options.verticalAxis ?? 0, 0, 0],
    buttons,
    hapticActuators: [],
    vibrationActuator: {
      playEffect: async () => 'complete',
      reset: async () => 'complete',
      pulse: async () => true,
    },
  };
}
