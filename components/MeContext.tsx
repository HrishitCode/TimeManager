"use client";

import { createContext, useContext } from "react";
import { colorAt } from "./ui";
import type { Me, Member } from "@/lib/shared/types";

interface Ctx {
  me: Me;
  reloadMe: () => Promise<void>;
}

export const MeContext = createContext<Ctx | null>(null);

export const useMe = () => {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe outside MeContext");
  return ctx;
};

/** People to show side by side: you first, then workspace mates. */
export const usePeople = () => {
  const { me } = useMe();
  const members: Member[] = me.workspace?.members ?? [{ ...me.user, role: "owner" }];
  const sorted = [...members].sort((a, b) => (a.id === me.user.id ? -1 : b.id === me.user.id ? 1 : 0));
  return sorted.map((m, i) => ({ ...m, color: colorAt(i), isMe: m.id === me.user.id, label: m.id === me.user.id ? "You" : m.name }));
};

export type Person = ReturnType<typeof usePeople>[number];
