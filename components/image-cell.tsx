"use client";

import { useRef, useState } from "react";
import { compressImage } from "@/components/comments";
import { cn } from "@/lib/utils";
import {
  ImagePlus, X, Shapes, TrendingUp, Trophy, Coins, Zap, Globe, Flag, Star,
  Heart, Users, Gamepad2, Music, Plane, Car, Home, Cpu, Film, Landmark,
  Rocket, CalendarDays, Target, Bitcoin, Banknote, PiggyBank,
  CircleDollarSign, Percent, Scale, Gavel, Vote, Building2, Factory, Store,
  Briefcase, Newspaper, ChartLine, Signal, Wifi, Smartphone, Tv, Camera, Mic,
  Headphones, Radio, Podcast, Clapperboard, Ticket, Volleyball, Medal, Crown,
  Gem, Award, Gift, Cake, Wine, Coffee, Leaf, Sprout, Flower2, Mountain, Sun,
  Moon, Snowflake, Umbrella, Timer, Bell, Lightbulb, MapPin, ThumbsUp, Swords,
  Shield,
} from "lucide-react";

// Curated Lucide glyphs for the market icon. A pick serializes the rendered
// <svg> to a data URI so it rides the existing imageUrl pipeline. currentColor
// is stamped to brand green — inside an <img> it would otherwise render black.
const ICON_PICK = [
  TrendingUp, Trophy, Coins, Zap, Globe, Flag, Star, Heart, Users, Gamepad2,
  Music, Plane, Car, Home, Cpu, Film, Landmark, Rocket, CalendarDays, Target,
  Bitcoin, Banknote, PiggyBank, CircleDollarSign, Percent, Scale, Gavel, Vote,
  Building2, Factory, Store, Briefcase, Newspaper, ChartLine, Signal, Wifi,
  Smartphone, Tv, Camera, Mic, Headphones, Radio, Podcast, Clapperboard, Ticket,
  Volleyball, Medal, Crown, Gem, Award, Gift, Cake, Wine, Coffee, Leaf, Sprout,
  Flower2, Mountain, Sun, Moon, Snowflake, Umbrella, Timer, Bell, Lightbulb,
  MapPin, ThumbsUp, Swords, Shield,
];

export function IconPicker({ onPick, hint }: { onPick: (v: string) => void; hint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        title={hint}
        onClick={() => setOpen((v) => !v)}
        className="size-10 grid place-items-center rounded-lg border border-dashed border-line text-faint hover:text-ink hover:border-faint cursor-pointer"
      >
        <Shapes className="size-4" />
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-20 grid w-[216px] grid-cols-6 gap-0.5 rounded-xl border border-line bg-surface p-1.5 shadow-[0_8px_24px_rgba(16,16,20,0.12)] max-h-56 overflow-y-auto">
          {ICON_PICK.map((Icon, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                // SAFETY: lucide buttons always render a single svg child.
                const svg = e.currentTarget.querySelector("svg")?.outerHTML;
                if (svg) onPick(`data:image/svg+xml;utf8,${encodeURIComponent(svg.replaceAll("currentColor", "#0f9d58"))}`);
                setOpen(false);
              }}
              className="size-8.5 grid place-items-center rounded-md text-mute hover:bg-surface-2 hover:text-ink cursor-pointer"
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Compact image picker cell: click to upload, paste an image or URL, drop a
// file, right-click for a URL field. Uploads compress to data-URLs.
export function ImageCell({
  image,
  onImage,
  imageHint,
  onBadImage,
  className = "size-9",
}: {
  image: string;
  onImage: (v: string) => void;
  imageHint: string;
  onBadImage: () => void;
  className?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlMode, setUrlMode] = useState(false);

  const acceptFile = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return onBadImage();
    onImage(await compressImage(f));
  };

  if (image)
    return (
      <div className={cn("relative shrink-0 group", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- data-URI/remote preview */}
        <img src={image} alt="" className="size-full rounded-lg border border-line object-cover" />
        <button
          type="button"
          onClick={() => onImage("")}
          className="absolute -right-1.5 -top-1.5 size-4.5 rounded-full bg-ink text-surface grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          aria-label="Remove image"
        >
          <X className="size-3" />
        </button>
      </div>
    );

  if (urlMode)
    return (
      <input
        autoFocus
        placeholder="https://…"
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && /^(https?:\/\/|\/)\S+$/.test(v)) onImage(v);
          setUrlMode(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { e.currentTarget.value = ""; e.currentTarget.blur(); }
        }}
        className="h-9 w-24 shrink-0 rounded-lg border border-line bg-surface px-2 text-[12px] focus:outline-2 focus:outline-brand"
      />
    );

  return (
    <>
      <button
        type="button"
        title={imageHint}
        onClick={() => fileRef.current?.click()}
        onContextMenu={(e) => {
          e.preventDefault();
          setUrlMode(true);
        }}
        onPaste={async (e) => {
          const f = e.clipboardData?.files?.[0];
          if (f) {
            e.preventDefault();
            await acceptFile(f);
            return;
          }
          const txt = e.clipboardData?.getData("text")?.trim();
          if (txt && /^(https?:\/\/|\/)\S+$/.test(txt)) {
            e.preventDefault();
            onImage(txt);
          }
        }}
        onDrop={async (e) => {
          e.preventDefault();
          await acceptFile(e.dataTransfer?.files?.[0]);
        }}
        onDragOver={(e) => e.preventDefault()}
        className={cn("shrink-0 grid place-items-center rounded-lg border border-dashed border-line text-faint hover:text-ink hover:border-faint cursor-pointer", className)}
      >
        <ImagePlus className="size-4" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          await acceptFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );
}
