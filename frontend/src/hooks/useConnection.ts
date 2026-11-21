import { useSyncExternalStore } from "react";

import { type ConnectionState, getConnection, subscribeConnection } from "../services/connection";

export function useConnection(): ConnectionState {
  return useSyncExternalStore(subscribeConnection, getConnection, getConnection);
}
