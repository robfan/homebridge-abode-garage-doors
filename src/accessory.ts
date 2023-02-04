import {
	CharacteristicEventTypes,
	CharacteristicSetCallback,
	CharacteristicValue,
	PlatformAccessory,
	Service,
} from "homebridge";

import { AbodeGarageDoorsPlatform } from "./platform";
import { controlGarageDoor } from "./abode/api";

export class AbodeGarageDoorAccessory {
	public service: Service;

	constructor(private readonly platform: AbodeGarageDoorsPlatform, private readonly accessory: PlatformAccessory) {
		this.accessory
			.getService(this.platform.Service.AccessoryInformation)!
			.setCharacteristic(this.platform.Characteristic.Manufacturer, "abode")
			.setCharacteristic(this.platform.Characteristic.Model, "Garage Door")
			.setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.id)
			.setCharacteristic(this.platform.Characteristic.AppMatchingIdentifier, "com.abode.abode");

		this.service =
			this.accessory.getService(this.platform.Service.GarageDoorOpener) ||
			this.accessory.addService(this.platform.Service.GarageDoorOpener);

		this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

		this.service
			.getCharacteristic(this.platform.Characteristic.TargetDoorState)
			.on(CharacteristicEventTypes.SET, this.setGarageDoorState.bind(this));
	}

	async setGarageDoorState(value: CharacteristicValue, callback: CharacteristicSetCallback) {
		this.platform.log.debug("setGarageDoorState", this.accessory.context.device.id, value);

		try {
			const status = this.platform.convertGarageDoorTargetStateToAbodeGarageDoorStatusInt(value);
			await controlGarageDoor(this.accessory.context.device.id, status);
			callback();
		} catch (error: any) {
			this.platform.log.error("setGarageDoorState failed", error.message);
			callback(error);
		}
	}
}
