"use client";

import { Button } from "@brainagent/ui";
import { ImagePlus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { AgentFace } from "@/components/avatar/agent-face";

/** Uploaded pictures are cropped to the portraits' 3:4 and resized before leaving the browser. */
const WIDTH = 600;
const HEIGHT = 800;

async function toPortrait(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    // Cover: crop the centre horizontally, keep the top (faces), like object-top.
    const scale = Math.max(WIDTH / img.naturalWidth, HEIGHT / img.naturalHeight);
    const w = Math.round(WIDTH / scale);
    const h = Math.round(HEIGHT / scale);
    const sx = Math.max(0, Math.round((img.naturalWidth - w) / 2));
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, WIDTH, HEIGHT);
    g.drawImage(img, sx, 0, w, h, 0, 0, WIDTH, HEIGHT);
    const webp = canvas.toDataURL("image/webp", 0.85);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The agent's own picture: upload one, or remove it to go back to the persona's portrait. */
export function AgentImagePicker({
  value,
  fallback,
  name,
  onChange,
}: {
  value: string | null;
  /** The persona's portrait, shown while the agent has no picture of its own. */
  fallback: string | null;
  name: string;
  onChange: (value: string | null) => void;
}) {
  const t = useTranslations("agents");
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState(false);

  return (
    <div className="flex items-center gap-4">
      <AgentFace
        src={value ?? fallback}
        name={name || "?"}
        className="aspect-[3/4] w-20 rounded-xl text-xl"
      />
      <div className="flex flex-col items-start gap-2">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="agent-image-input"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setError(false);
            try {
              onChange(await toPortrait(file));
            } catch {
              setError(true);
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => input.current?.click()}
          data-testid="agent-image-upload"
        >
          <ImagePlus className="size-4" />
          {value ? t("imageChange") : t("imageUpload")}
        </Button>
        {value ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange(null)}
            data-testid="agent-image-remove"
          >
            <Trash2 className="size-4" />
            {t("imageRemove")}
          </Button>
        ) : null}
        <p className="text-xs text-ink-3">{error ? t("imageInvalid") : t("imageHint")}</p>
      </div>
    </div>
  );
}
