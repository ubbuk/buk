import { Box, ChevronsRight, Layers, Paperclip, Send, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { HudPanel } from "./HudPanel";

export type StepState = "active" | "done" | "todo";

const STEPS: { label: string; icon: LucideIcon }[] = [
  { label: "Захиалгын мэдээлэл", icon: Layers },
  { label: "Материал сонгох", icon: Box },
  { label: "Хавсралт нэмэх", icon: Paperclip },
  { label: "Илгээх / Баталгаажуулах", icon: Send },
];

// Purely a view over the form's own progress (see MaterialRequestForm) -- it
// never represents a backend approval state.
export function WorkflowStrip({ states }: { states: [StepState, StepState, StepState, StepState] }) {
  return (
    <ol className="grid grid-cols-2 items-center gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]" aria-label="Захиалгын явц">
      {STEPS.map((step, i) => {
        const state = states[i];
        const Icon = step.icon;
        return (
          <li key={step.label} className="contents">
            <HudPanel
              tone={state === "active" ? "amber" : "cyan"}
              active={state === "active"}
              chamfer={12}
              className={cn("transition-[filter] duration-300", state === "active" && "drop-shadow-[0_0_10px_rgba(255,170,0,0.35)]")}
              innerClassName="flex items-center gap-3 px-3 py-2.5"
            >
              <span
                aria-current={state === "active" ? "step" : undefined}
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-lg border transition-colors duration-300",
                  state === "active" && "border-accent bg-accent/15 text-accent",
                  state === "done" && "border-success/60 bg-success/10 text-success",
                  state === "todo" && "border-tech/40 bg-tech/5 text-tech"
                )}
              >
                <Icon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold tabular-nums text-text-muted">0{i + 1}</span>
                <span className="block truncate max-sm:whitespace-normal max-sm:break-words text-sm font-semibold text-text">{step.label}</span>
              </span>
            </HudPanel>
            {i < STEPS.length - 1 && <ChevronsRight className="hidden size-5 text-tech/70 lg:block" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
