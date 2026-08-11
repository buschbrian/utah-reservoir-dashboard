export type DataState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ready"; count: number }
  | { kind: "error" };

export interface StateDescription {
  heading: string;
  detail: string;
  role: "status" | "alert";
}

export function describeDataState(state: DataState): StateDescription {
  switch (state.kind) {
    case "loading":
      return {
        heading: "Loading reservoir data",
        detail: "Checking the latest published storage records.",
        role: "status"
      };
    case "empty":
      return {
        heading: "No reservoirs are available",
        detail: "The data file loaded successfully but did not contain any records.",
        role: "status"
      };
    case "ready":
      return {
        heading: "Reservoir data ready",
        detail: `${state.count} reservoir records passed validation.`,
        role: "status"
      };
    case "error":
      return {
        heading: "Reservoir data is unavailable",
        detail: "Reload the page. If the problem continues, try again later.",
        role: "alert"
      };
  }
}

export interface DashboardCapabilities {
  customElements: boolean;
  resizeObserver: boolean;
  webgl2: boolean;
}

export function supportsDashboard(capabilities: DashboardCapabilities): boolean {
  return capabilities.customElements && capabilities.resizeObserver && capabilities.webgl2;
}
