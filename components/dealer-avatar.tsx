import { Spade } from "lucide-react";
import { cn } from "@/lib/utils";

// Avatar may be an uploaded image (data URI or URL), a short monogram, or
// empty — in which case the plain Spade icon fills the tile.
export function DealerAvatar({ avatar, className }: { avatar: string; className?: string }) {
  const isImg = /^(data:image\/|https?:\/\/|\/)\S+/.test(avatar);
  return (
    <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-md bg-surface-3 text-[11px] font-bold text-mute", className)}>
      {isImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" className="h-full w-full object-cover" />
      ) : avatar ? (
        avatar
      ) : (
        <Spade className="size-3.5" />
      )}
    </span>
  );
}
