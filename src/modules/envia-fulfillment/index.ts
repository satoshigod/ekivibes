import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import EnviaFulfillmentProviderService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [EnviaFulfillmentProviderService],
})
