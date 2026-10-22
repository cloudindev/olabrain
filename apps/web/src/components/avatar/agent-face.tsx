import { cn } from "@brainagent/ui";
import { DEFAULT_AVATAR } from "./avatar-config";

/** The face the agent shows in its conversation (thumbnail of its video avatar). */
export function AgentFace({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${DEFAULT_AVATAR}/face.jpg`}
      alt=""
      className={cn("shrink-0 border border-line bg-white object-cover", className)}
    />
  );
}
