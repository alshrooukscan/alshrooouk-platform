"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

// One hook, used on every dashboard list/detail page that needs to reflect a
// change made by someone else without a manual reload. Subscribes to Postgres
// changes on the given tables and calls the caller's own load function after
// a short debounce - several changes landing together (a visit plus its
// auto-created report row, for instance) trigger one reload, not three.
//
// Live dashboard (Mohamed Said, 23 Oct 2026): on top of the change feed it
// also reloads when the tab comes back into view (a laptop waking up, a
// switched browser tab) and every `pollMs` while visible, so a dropped socket
// or a table that does not broadcast can never leave a stale number on screen.
//
// employees and staff_profiles are deliberately never passed in here: Realtime
// broadcasts the full row over the wire regardless of column-level grants, so
// subscribing to either would leak salary/national_id/permissions straight
// past the lockdown those tables already have, through the payload instead
// of a query. Any page needing to react to an employee or staff change should
// refresh on a table that already carries a safe pointer to it (e.g. visits'
// assigned_employee_id) rather than subscribing to the row itself.

// Shared live status for the indicator in the dashboard header.
const listeners = new Set();
let liveState = { connected: false, lastUpdated: null };
function publish(patch) {
  liveState = { ...liveState, ...patch };
  listeners.forEach((fn) => fn(liveState));
}
export function useLiveStatus() {
  const [s, setS] = useState(liveState);
  useEffect(() => {
    listeners.add(setS);
    return () => listeners.delete(setS);
  }, []);
  return s;
}

export function useAutoRefresh(tables, onChange, { pollMs = 60000 } = {}) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    if (!tables || !tables.length) return;
    let timer = null;
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try {
        await cbRef.current();
        publish({ lastUpdated: new Date() });
      } finally {
        running = false;
      }
    };
    const trigger = () => {
      clearTimeout(timer);
      timer = setTimeout(run, 600);
    };

    const channelName = `auto-refresh-${tables.join("-")}-${Math.random().toString(36).slice(2, 8)}`;
    let channel = supabase.channel(channelName);
    tables.forEach((table) => {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, trigger);
    });
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") publish({ connected: true });
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") publish({ connected: false });
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") trigger();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const poll = pollMs
      ? setInterval(() => {
          if (document.visibilityState === "visible") run();
        }, pollMs)
      : null;
    publish({ lastUpdated: new Date() });

    return () => {
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join("|"), pollMs]);
}
