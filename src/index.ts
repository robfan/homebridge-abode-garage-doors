import { API } from "homebridge";
import { AbodeGarageDoorsPlatform } from "./platform";
import { PLATFORM_NAME } from "./constants";

export = (api: API) => {
	api.registerPlatform(PLATFORM_NAME, AbodeGarageDoorsPlatform);
};
