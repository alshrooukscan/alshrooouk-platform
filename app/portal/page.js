"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PortalRoot() {
  const router = useRouter();
  useEffect(() => {
    fetch("/api/portal/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.authenticated) {
          router.replace(`/portal/${data.role}`);
        } else {
          router.replace("/portal/login");
        }
      });
  }, [router]);
  return null;
}
