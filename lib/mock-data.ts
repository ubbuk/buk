// Real actions (submit, approve, warehouse check, return, etc.) push their
// own entries into the activity log via lib/store.ts's pushActivity — it
// starts empty rather than fake history.
export const DEMO_ACTIVITY: { id: string; time: string; text: string; type: "create" | "approve" | "reject" | "info" }[] = [];
