import {
	API,
	Characteristic,
	CharacteristicValue,
	DynamicPlatformPlugin,
	Logger,
	PlatformAccessory,
	PlatformConfig,
	Service,
} from "homebridge";
import { AbodeEvents, DEVICE_UPDATED, SOCKET_CONNECTED, SOCKET_DISCONNECTED } from "./abode/events";
import {
	AbodeGarageDoorDevice,
	AbodeGarageDoorStatus,
	AbodeGarageDoorStatusInt,
	abodeInit,
	getDevices,
	isDeviceTypeGarageDoor,
} from "./abode/api";
import { PLATFORM_NAME, PLUGIN_NAME } from "./constants";

import { AbodeGarageDoorAccessory } from "./accessory";

interface Config extends PlatformConfig {
	readonly email?: string;
	readonly password?: string;
}

export class AbodeGarageDoorsPlatform implements DynamicPlatformPlugin {
	public readonly Service: typeof Service = this.api.hap.Service;
	public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

	public readonly accessories: PlatformAccessory[] = [];

	private socketConnected = false;

	constructor(public readonly log: Logger, public readonly config: Config, public readonly api: API) {
		this.log.debug("Finished initializing AbodeGarageDoorsPlatform");

		this.api.on("didFinishLaunching", async () => {
			log.debug("Executed didFinishLaunching callback");

			try {
				if (!config.email || !config.password) {
					throw new Error("Missing email and password");
				}

				await abodeInit({
					email: config.email,
					password: config.password,
					logger: log,
					homebridgeVersion: api.serverVersion,
				});
			} catch (error: any) {
				log.error("Failed to initialize:", error.message);
				return;
			}

			await this.discoverDevices();
			await this.updateStatus();

			AbodeEvents.on(SOCKET_CONNECTED, () => {
				this.socketConnected = true;
				log.debug("Socket connected");
			});
			AbodeEvents.on(SOCKET_DISCONNECTED, () => {
				this.socketConnected = false;
				log.debug("Socket disconnected");
				setTimeout(() => {
					if (!this.socketConnected) {
						this.setStatusUnknown();
					}
				}, 30000);
			});
			AbodeEvents.on(DEVICE_UPDATED, this.handleDeviceUpdated.bind(this));
		});
	}

	configureAccessory(accessory: PlatformAccessory) {
		this.log.info("Loading accessory from cache:", accessory.displayName);

		this.accessories.push(accessory);
	}

	async discoverDevices() {
		try {
			const devices = await getDevices();

			for (const device of devices) {
				if (!isDeviceTypeGarageDoor(device)) continue;

				const uuid = this.api.hap.uuid.generate(device.id);

				const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

				if (existingAccessory) {
					if (device) {
						this.log.info("Restoring existing accessory from cache:", existingAccessory.displayName);

						existingAccessory.context.device = {
							id: device.id,
							name: device.name,
						};
						new AbodeGarageDoorAccessory(this, existingAccessory);

						this.api.updatePlatformAccessories([existingAccessory]);
					} else if (!device) {
						this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
						this.log.info("Removing existing accessory from cache:", existingAccessory.displayName);
					}
				} else {
					this.log.info("Adding new accessory:", device.name);

					const accessory = new this.api.platformAccessory(device.name, uuid);
					accessory.context.device = {
						id: device.id,
						name: device.name,
					};

					new AbodeGarageDoorAccessory(this, accessory);

					this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
					this.accessories.push(accessory);
				}
			}
		} catch (error: any) {
			this.log.error("Failed to discoverDevices", error.message);
		}
	}

	async updateStatus() {
		try {
			const devices = await getDevices();

			for (const accessory of this.accessories) {
				const id = accessory.context.device.id;
				const device = devices.find((d) => d.id === id);
				if (!device) {
					this.log.warn("updateStatus did not find device", id);
					continue;
				}

				if (!isDeviceTypeGarageDoor(device)) {
					this.log.warn("updateStatus did not find device with garage door type", id);
					continue;
				}

				const service = accessory.getService(this.Service.GarageDoorOpener);
				if (!service) {
					this.log.warn("updateStatus did not find garage door service for device", id);
					continue;
				}

				const currentState = this.convertAbodeGarageDoorStatusToGarageDoorCurrentState(device);

				service.getCharacteristic(this.Characteristic.CurrentDoorState).updateValue(currentState);
				service.getCharacteristic(this.Characteristic.TargetDoorState).updateValue(currentState);
			}
		} catch (error: any) {
			this.log.error("Failed to updateStatus", error.message);
			this.setStatusUnknown();
		}
	}

	setStatusUnknown() {
		try {
			for (const accessory of this.accessories) {
				const service = accessory.getService(this.Service.GarageDoorOpener);
				if (!service) {
					this.log.warn("updateStatus did not find garage door service for device", accessory.context.device.id);
					continue;
				}

				service
					.getCharacteristic(this.Characteristic.CurrentDoorState)
					.updateValue(this.Characteristic.CurrentDoorState.STOPPED);
			}
		} catch (error: any) {
			this.log.error("Failed to handleUnresponsive", error.message);
		}
	}

	handleDeviceUpdated(deviceId: string) {
		this.log.debug("handleDeviceUpdated", deviceId);

		const device = this.accessories.find((a) => a.context.device.id === deviceId);
		if (device) {
			this.updateStatus();
		}
	}

	convertAbodeGarageDoorStatusToGarageDoorCurrentState(device: AbodeGarageDoorDevice): CharacteristicValue {
		if (device.faults.jammed === 1) {
			return this.Characteristic.CurrentDoorState.STOPPED;
		}

		switch (device.status) {
			case AbodeGarageDoorStatus.Closed:
				return this.Characteristic.CurrentDoorState.CLOSED;
			case AbodeGarageDoorStatus.Open:
				return this.Characteristic.CurrentDoorState.OPEN;
			default:
				return this.Characteristic.CurrentDoorState.OPEN;
		}
	}

	convertGarageDoorTargetStateToAbodeGarageDoorStatusInt(value: CharacteristicValue): AbodeGarageDoorStatusInt {
		switch (value) {
			case this.Characteristic.TargetDoorState.OPEN:
				return AbodeGarageDoorStatusInt.Open;
			case this.Characteristic.TargetDoorState.CLOSED:
				return AbodeGarageDoorStatusInt.Closed;
			default:
				throw new Error(`Unexpected TargetDoorState: ${value}`);
		}
	}
}
