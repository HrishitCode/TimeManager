"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/client/notify";

export default function ServiceWorker() {
  useEffect(registerServiceWorker, []);
  return null;
}
