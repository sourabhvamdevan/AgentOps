import { api } from "../services/api";
import { useApi } from "./useApi";

export function useHealth() {
  return useApi(api.health);
}
