import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { sendNotificationStep } from "./steps/send-notification"

type BusinessRegistrationInput = {
  store: "ekivibes" | "hitair-colombia"
  companyName: string
  taxId?: string
  contactName: string
  contactRole?: string
  email: string
  phone: string
  city: string
  department?: string
  businessType: string
  estimatedVolume?: string
  message?: string
  adminEmail: string
}

export const sendBusinessRegistrationWorkflow = createWorkflow(
  "send-business-registration",
  (input: BusinessRegistrationInput) => {
    const notifications = sendNotificationStep([
      {
        to: input.adminEmail,
        channel: "email",
        template: "business-registration-admin",
        data: input,
      },
      {
        to: input.email,
        channel: "email",
        template: "business-registration-confirmation",
        data: input,
      },
    ])

    return new WorkflowResponse({ notifications })
  }
)
