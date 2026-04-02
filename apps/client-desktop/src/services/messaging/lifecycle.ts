import type { DeliveryState } from "@project/protocol";

import type { LocalMessage, MessageLifecycleState } from "@/state/messagingStore";

export function messageLifecycleFromDeliveryState(deliveryState: DeliveryState, expired: boolean): MessageLifecycleState {
  if (expired) {
    return "expired";
  }

  switch (deliveryState) {
    case "queued":
      return "queued";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "failed":
      return "failed";
    case "expired":
      return "expired";
    case "pending":
    default:
      return "sending";
  }
}

export function deriveMessageLifecycle(message: Pick<LocalMessage, "lifecycle" | "deliveryState" | "expired">): MessageLifecycleState {
  if (message.lifecycle) {
    return message.lifecycle;
  }
  return messageLifecycleFromDeliveryState(message.deliveryState, Boolean(message.expired));
}

export function isTerminalLifecycle(lifecycle: MessageLifecycleState): boolean {
  return lifecycle === "failed" || lifecycle === "delivered" || lifecycle === "expired";
}
