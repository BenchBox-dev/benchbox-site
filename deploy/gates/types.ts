export type GateStatus = "pass" | "fail" | "skipped";
export type GateResult = { status: GateStatus; detail: string; findings?: string[] };

export const pass = (detail: string): GateResult => ({ status: "pass", detail });
export const skipped = (detail: string): GateResult => ({ status: "skipped", detail });
export const fail = (detail: string, findings: string[] = []): GateResult => ({ status: "fail", detail, findings });
